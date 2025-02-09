import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogComponent } from '../../utils/logger';
import { CloudflareApiService } from '../cloudflareApiService';
import { ProfileManager } from '../profileManager';
import { TunnelLogger } from './TunnelLogger';
import { TunnelConfig } from './TunnelConfig';
import * as util from 'util';

export interface CloudflareTunnel {
    id: string;
    name: string;
    created_at: string;
    deleted_at?: string;
    account_tag: string;
    connections?: Array<{
        id: string;
        connected_at: string;
        disconnected_at?: string;
        status: string;
        colo_name: string;
        uuid: string;
        is_pending_reconnect: boolean;
        origin_ip: string;
        opened_at: string;
        client_id: string;
        client_version: string;
    }>;
    conns_active_at: string | null;
    conns_inactive_at: string | null;
    tun_type: string;
    metadata: Record<string, any>;
    status: string;
    remote_config: boolean;
}

export type TunnelEventType = 'start' | 'stop' | 'error' | 'status';

export interface TunnelEvent {
    type: TunnelEventType;
    tunnelId: string;
    message?: string;
    data?: any;
}

export class TunnelManager {
    private readonly runningTunnels: Map<string, { 
        process: cp.ChildProcess; 
        pid: number; 
        logStreams: fs.WriteStream[] 
    }> = new Map();

    private readonly _onTunnelEvent = new vscode.EventEmitter<TunnelEvent>();
    readonly onTunnelEvent = this._onTunnelEvent.event;
    private readonly tunnelLogger: TunnelLogger;
    private readonly tunnelConfig: TunnelConfig;

    constructor(
        private context: vscode.ExtensionContext,
        private logger: Logger,
        private apiService: CloudflareApiService,
        private profileManager: ProfileManager
    ) {
        this.tunnelLogger = new TunnelLogger(logger, context.globalStoragePath);
        this.tunnelConfig = new TunnelConfig(context, logger, context.globalStoragePath);
    }

    async createTunnel(name: string): Promise<CloudflareTunnel> {
        try {
            const tunnel = await this.apiService.createTunnel(name);
            this.logger.info(LogComponent.TUNNEL, `Created tunnel: ${name} with ID: ${tunnel.id}`);

            // Get the token and save the initial configuration
            const token = await this.apiService.getTunnelToken(tunnel.id);
            const activeProfile = await this.profileManager.getActiveProfile();
            if (!activeProfile) {
                throw new Error('No active profile found');
            }
            const accountId = await this.profileManager.getProfileAccountId(activeProfile);
            if (!accountId) {
                throw new Error('No account ID found in active profile');
            }

            const config = {
                accountId,
                tunnelId: tunnel.id,
                tunnelName: name,
                credentials: {
                    accountTag: tunnel.account_tag,
                    tunnelSecret: token
                },
                ingress: [{
                    service: 'http_status:404'
                }]
            };

            await this.tunnelConfig.saveTunnelConfig(tunnel.id, config);
            return tunnel;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to create tunnel: ${error}`);
            throw error;
        }
    }

    async deleteTunnel(tunnelId: string): Promise<void> {
        try {
            await this.stopTunnel(tunnelId);
            await this.apiService.deleteTunnel(tunnelId);
            await this.tunnelConfig.deleteTunnelConfig(tunnelId);
            this.logger.info(LogComponent.TUNNEL, `Deleted tunnel: ${tunnelId}`);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to delete tunnel: ${error}`);
            throw error;
        }
    }

    async listTunnels(): Promise<Array<{ id: string; name: string; connections?: Array<any>; url?: string }>> {
        try {
            return await this.apiService.listTunnels();
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to list tunnels: ${error}`);
            throw error;
        }
    }

    private async findCloudflaredPath(): Promise<string> {
        const platform = process.platform;
        const isWindows = platform === 'win32';
        const cloudflaredName = isWindows ? 'cloudflared.exe' : 'cloudflared';
        
        // Check in extension's global storage first
        const storagePath = path.join(this.context.globalStoragePath, 'bin', cloudflaredName);
        if (fs.existsSync(storagePath)) {
            return storagePath;
        }

        // Check in PATH
        const which = require('which');
        try {
            return await which(cloudflaredName);
        } catch {
            throw new Error('cloudflared not found. Please install it first.');
        }
    }

    async runTunnel(tunnelId: string, port: number): Promise<cp.ChildProcess> {
        if (this.runningTunnels.has(tunnelId)) {
            throw new Error(`Tunnel ${tunnelId} is already running`);
        }

        try {
            // Get tunnel info first to include name in logs
            const tunnelInfo = await this.apiService.getTunnelInfo(tunnelId);
            if (!tunnelInfo || !tunnelInfo.name) {
                throw new Error('Failed to get tunnel information');
            }

            // Get the token
            this.logger.debug(LogComponent.TUNNEL, 'Getting tunnel token...', { preserveFocus: true });
            const token = await this.apiService.getTunnelToken(tunnelId);
            if (!token) {
                throw new Error('Failed to get tunnel token');
            }

            // Get account ID from active profile
            const activeProfile = await this.profileManager.getActiveProfile();
            if (!activeProfile) {
                throw new Error('No active profile found');
            }
            const accountId = await this.profileManager.getProfileAccountId(activeProfile);
            if (!accountId) {
                throw new Error('No account ID found in active profile');
            }

            // Create initial configuration if it doesn't exist
            const config = {
                accountId,
                tunnelId: tunnelId,
                tunnelName: tunnelInfo.name,
                credentials: {
                    accountTag: tunnelInfo.account_tag,
                    tunnelSecret: token
                },
                ingress: [{
                    service: `http://localhost:${port}`
                }, {
                    service: 'http_status:404'
                }]
            };

            // Save the configuration
            await this.tunnelConfig.saveTunnelConfig(tunnelId, config);

            const cloudflaredPath = await this.findCloudflaredPath();
            
            // Build command with token-based auth and url before run
            const args = ['tunnel'];
            if (port) {
                args.push('--url', `http://localhost:${port}`);
            }
            args.push('run', '--token', token);

            const process = cp.spawn(cloudflaredPath, args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            const logStream = this.tunnelLogger.createLogStream(tunnelId);
            process.stdout.pipe(logStream);
            process.stderr.pipe(logStream);

            this.runningTunnels.set(tunnelId, {
                process,
                pid: process.pid!,
                logStreams: [logStream]
            });

            // Handle process events
            process.on('error', (error) => {
                this.logger.error(LogComponent.TUNNEL, `Tunnel process error: ${error}`);
                this._onTunnelEvent.fire({
                    type: 'error',
                    tunnelId,
                    message: error.message
                });
            });

            process.on('exit', (code, signal) => {
                this.logger.info(
                    LogComponent.TUNNEL,
                    `Tunnel process exited with code ${code}, signal ${signal}`
                );
                this.cleanupTunnelProcess(tunnelId);
            });

            // Log and emit start event
            await this.tunnelLogger.logTunnelEvent(tunnelId, 'started', { port });
            this._onTunnelEvent.fire({
                type: 'start',
                tunnelId,
                message: `Tunnel started for port ${port}`
            });

            return process;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to run tunnel: ${error}`);
            throw error;
        }
    }

    private async cleanupTunnelProcess(tunnelId: string): Promise<void> {
        const runningTunnel = this.runningTunnels.get(tunnelId);
        if (!runningTunnel) {
            return;
        }

        // Close log streams
        for (const stream of runningTunnel.logStreams) {
            stream.end();
        }

        this.runningTunnels.delete(tunnelId);
        await this.tunnelLogger.logTunnelEvent(tunnelId, 'stopped');
        this._onTunnelEvent.fire({
            type: 'stop',
            tunnelId,
            message: 'Tunnel stopped'
        });
    }

    /**
     * Finds all cloudflared processes
     * @returns Array of PIDs and their command lines
     */
    private async findCloudflaredProcesses(): Promise<Array<{ pid: number; cmdline: string }>> {
        try {
            // Use ps aux to find all cloudflared processes and get their command lines
            const { stdout } = await util.promisify(cp.exec)('ps aux | grep cloudflared | grep -v grep');
            const processes = stdout.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[1]);
                    const cmdline = parts.slice(10).join(' '); // Command is everything after the 10th column
                    return { pid, cmdline };
                })
                .filter(p => p.pid && p.cmdline); // Filter out any invalid entries

            this.logger.debug(LogComponent.TUNNEL, `Found ${processes.length} cloudflared processes`);
            return processes;
        } catch (error) {
            // If command fails, no processes found
            this.logger.debug(LogComponent.TUNNEL, 'No cloudflared processes found');
            return [];
        }
    }

    /**
     * Finds a specific tunnel process
     * @param identifier - Either a tunnel ID or port number
     * @returns Process info if found
     */
    private async findTunnelProcess(identifier: string | number): Promise<Array<{ pid: number; cmdline: string }>> {
        const processes = await this.findCloudflaredProcesses();
        
        // If identifier is a number, look for port
        if (typeof identifier === 'number') {
            return processes.filter(p => p.cmdline.includes(`localhost:${identifier}`));
        }
        
        // If identifier is a string (tunnel ID), look for token or tunnel ID
        return processes.filter(p => 
            p.cmdline.includes(`--token`) && // Only look in processes using token auth
            p.cmdline.includes(identifier) // Must include the exact tunnel ID
        );
    }

    /**
     * Kills a process with retries and force if needed
     */
    private async killProcess(pid: number, graceful: boolean = true): Promise<boolean> {
        try {
            if (graceful) {
                // On macOS, we need to use sudo for some cloudflared processes
                if (process.platform === 'darwin') {
                    try {
                        // Try pkill first as it might not require sudo
                        await util.promisify(cp.exec)(`pkill -TERM -P ${pid}`).catch(() => {});
                        await util.promisify(cp.exec)(`pkill -TERM -f "cloudflared.*${pid}"`).catch(() => {});
                        await util.promisify(cp.exec)(`pkill -TERM -f "cloudflared.*tunnel.*run"`).catch(() => {});
                    } catch (error) {
                        // If pkill fails, try direct kill
                        try {
                            process.kill(pid, 'SIGTERM');
                        } catch (error) {
                            this.logger.warn(LogComponent.TUNNEL, `Failed to kill process ${pid} with SIGTERM`);
                        }
                    }
                } else {
                    process.kill(pid, 'SIGTERM');
                }
                
                // Wait for process to exit gracefully
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Check if process is still running
                try {
                    if (process.platform === 'darwin') {
                        const { stdout } = await util.promisify(cp.exec)(`ps -p ${pid} | grep -v PID`);
                        if (!stdout.trim()) {
                            return true; // Process is gone
                        }
                        // Process still running, try SIGKILL
                        await util.promisify(cp.exec)(`pkill -KILL -P ${pid}`).catch(() => {});
                        await util.promisify(cp.exec)(`pkill -KILL -f "cloudflared.*${pid}"`).catch(() => {});
                        await util.promisify(cp.exec)(`pkill -KILL -f "cloudflared.*tunnel.*run"`).catch(() => {});
                    } else {
                        process.kill(pid, 0);
                        process.kill(pid, 'SIGKILL');
                    }
                } catch (error) {
                    return true; // Process is gone
                }
            } else {
                // Skip graceful shutdown, go straight to SIGKILL
                if (process.platform === 'darwin') {
                    await util.promisify(cp.exec)(`pkill -KILL -P ${pid}`).catch(() => {});
                    await util.promisify(cp.exec)(`pkill -KILL -f "cloudflared.*${pid}"`).catch(() => {});
                    await util.promisify(cp.exec)(`pkill -KILL -f "cloudflared.*tunnel.*run"`).catch(() => {});
                } else {
                    process.kill(pid, 'SIGKILL');
                }
            }

            // Final verification
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                process.kill(pid, 0);
                return false; // Process still running
            } catch (error) {
                return true; // Process is gone
            }
        } catch (error) {
            this.logger.warn(LogComponent.TUNNEL, `Failed to kill process ${pid}`);
            return false;
        }
    }

    async stopTunnel(tunnelId: string): Promise<void> {
        try {
            const runningTunnel = this.runningTunnels.get(tunnelId);
            if (!runningTunnel) {
                this.logger.warn(LogComponent.TUNNEL, `No running tunnel found for ID: ${tunnelId}`);
                return;
            }

            this.logger.info(LogComponent.TUNNEL, `Stopping TUNNEL: ${tunnelId}`);

            // Kill the process
            if (process.platform === 'win32') {
                try {
                    process.kill(runningTunnel.pid);
                } catch (error) {
                    this.logger.warn(LogComponent.TUNNEL, `Failed to kill process: ${error}`);
                }
            } else {
                try {
                    process.kill(runningTunnel.pid, 'SIGTERM');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    try {
                        process.kill(runningTunnel.pid, 0);
                        // Process still running, try SIGKILL
                        process.kill(runningTunnel.pid, 'SIGKILL');
                    } catch (error) {
                        // Process is already dead
                    }
                } catch (error) {
                    this.logger.warn(LogComponent.TUNNEL, `Failed to kill process: ${error}`);
                }
            }

            // Clean up resources
            await this.cleanupTunnelProcess(tunnelId);

            this.logger.info(LogComponent.TUNNEL, `TUNNEL: ${tunnelId} stopped`);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to stop tunnel: ${error}`);
            throw error;
        }
    }

    async checkTunnelStatus(tunnelId: string): Promise<boolean> {
        try {
            const tunnel = await this.apiService.getTunnelInfo(tunnelId);
            return tunnel.status === 'active';
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to check tunnel status: ${error}`);
            return false;
        }
    }

    async updateTunnelConfig(tunnelId: string, updates: any): Promise<void> {
        try {
            // First try to load existing config
            let config = await this.tunnelConfig.loadTunnelConfig(tunnelId);
            
            if (!config) {
                // If no config exists, we need to create a new one
                const tunnelInfo = await this.apiService.getTunnelInfo(tunnelId);
                if (!tunnelInfo) {
                    throw new Error(`Failed to get tunnel info for ${tunnelId}`);
                }

                const token = await this.apiService.getTunnelToken(tunnelId);
                if (!token) {
                    throw new Error('Failed to get tunnel token');
                }

                const activeProfile = await this.profileManager.getActiveProfile();
                if (!activeProfile) {
                    throw new Error('No active profile found');
                }
                const accountId = await this.profileManager.getProfileAccountId(activeProfile);
                if (!accountId) {
                    throw new Error('No account ID found in active profile');
                }

                // Create base configuration
                config = {
                    accountId,
                    tunnelId: tunnelId,
                    tunnelName: tunnelInfo.name,
                    credentials: {
                        accountTag: tunnelInfo.account_tag,
                        tunnelSecret: token
                    },
                    ingress: [{
                        service: 'http_status:404'
                    }]
                };
            }

            // Merge the updates with existing or new config
            const updatedConfig = {
                ...config,
                ...updates,
                // Preserve nested objects that might be partially updated
                ingress: updates.ingress || config.ingress,
                credentials: updates.credentials || config.credentials
            };

            await this.tunnelConfig.saveTunnelConfig(tunnelId, updatedConfig);
            this.logger.info(LogComponent.TUNNEL, `Updated configuration for tunnel ${tunnelId}`);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to update tunnel configuration: ${error}`);
            throw error;
        }
    }

    async cleanup(): Promise<void> {
        // Stop all running tunnels
        for (const [tunnelId] of this.runningTunnels) {
            await this.stopTunnel(tunnelId);
        }
    }

    async createQuickTunnel(port: number): Promise<{ url: string; tunnelUrl: string } | null> {
        try {
            const cloudflaredPath = await this.findCloudflaredPath();
            const args = ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`];

            const process = cp.spawn(cloudflaredPath, args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            // Create a unique ID for the quick tunnel
            const quickTunnelId = `quick-${port}-${Date.now()}`;
            const logStream = this.tunnelLogger.createLogStream(quickTunnelId);

            // Buffer to store output until we find the tunnel URL
            let outputBuffer = '';
            let tunnelUrl: string | null = null;

            // Process stdout to find the tunnel URL
            process.stdout.on('data', (data: Buffer) => {
                const output = data.toString();
                outputBuffer += output;
                logStream.write(output);

                // Look for the tunnel URL in the output
                const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                if (match && !tunnelUrl) {
                    tunnelUrl = match[0];
                    this._onTunnelEvent.fire({
                        type: 'start',
                        tunnelId: quickTunnelId,
                        message: `Quick tunnel started for port ${port}`
                    });
                }
            });

            process.stderr.pipe(logStream);

            // Handle process events
            process.on('error', (error) => {
                this.logger.error(LogComponent.TUNNEL, `Quick tunnel process error: ${error}`);
                this._onTunnelEvent.fire({
                    type: 'error',
                    tunnelId: quickTunnelId,
                    message: error.message
                });
            });

            process.on('exit', (code, signal) => {
                this.logger.info(
                    LogComponent.TUNNEL,
                    `Quick tunnel process exited with code ${code}, signal ${signal}`
                );
                this.cleanupTunnelProcess(quickTunnelId);
            });

            // Store the process
            this.runningTunnels.set(quickTunnelId, {
                process,
                pid: process.pid!,
                logStreams: [logStream]
            });

            // Wait for the tunnel URL
            const maxWaitTime = 30000; // 30 seconds
            const startTime = Date.now();

            while (!tunnelUrl && Date.now() - startTime < maxWaitTime) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (!tunnelUrl) {
                // If we didn't get a URL, clean up and throw
                await this.stopQuickTunnel(port);
                throw new Error('Timed out waiting for quick tunnel URL');
            }

            return {
                url: `http://localhost:${port}`,
                tunnelUrl
            };
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to create quick tunnel: ${error}`);
            throw error;
        }
    }

    async stopQuickTunnel(port: number): Promise<void> {
        // Find the quick tunnel process for this port
        const quickTunnelId = Array.from(this.runningTunnels.entries())
            .find(([id, _]) => id.startsWith(`quick-${port}-`))?.[0];

        if (quickTunnelId) {
            await this.stopTunnel(quickTunnelId);
        }
    }
} 