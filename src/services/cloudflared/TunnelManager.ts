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

/**
 * Interface representing a Cloudflare tunnel's data structure
 */
export interface CloudflareTunnel {
    /** Unique identifier for the tunnel */
    id: string;
    /** User-defined name for the tunnel */
    name: string;
    /** Timestamp when the tunnel was created */
    created_at: string;
    /** Timestamp when the tunnel was deleted (if applicable) */
    deleted_at?: string;
    /** Account identifier tag */
    account_tag: string;
    /** Array of active connections for this tunnel */
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
    /** Timestamp of last active connection */
    conns_active_at: string | null;
    /** Timestamp of last inactive connection */
    conns_inactive_at: string | null;
    /** Type of tunnel */
    tun_type: string;
    /** Additional metadata */
    metadata: Record<string, any>;
    /** Current tunnel status */
    status: string;
    /** Whether the tunnel uses remote configuration */
    remote_config: boolean;
}

/** Types of events that can be emitted by the tunnel manager */
export type TunnelEventType = 'start' | 'stop' | 'error' | 'status';

/** Structure of tunnel events */
export interface TunnelEvent {
    type: TunnelEventType;
    tunnelId: string;
    message?: string;
    data?: any;
}

/**
 * TunnelManager - Core service for managing Cloudflare tunnels
 * 
 * This service is responsible for:
 * 1. Creating and managing tunnel processes
 * 2. Handling tunnel lifecycle (start, stop, delete)
 * 3. Managing tunnel configurations
 * 4. Monitoring tunnel status and health
 * 5. Emitting tunnel events for UI updates
 * 
 * Features:
 * - Process management for both persistent and quick tunnels
 * - Automatic cleanup of orphaned processes
 * - Event-based status updates
 * - Cross-platform support (Windows, macOS, Linux)
 * - Graceful shutdown handling
 */
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

    /**
     * Creates a new Cloudflare tunnel
     * @param name Name for the new tunnel
     * @returns Created tunnel information
     * @throws Error if tunnel creation fails
     */
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

    /**
     * Deletes a tunnel and its associated resources
     * @param tunnelId ID of the tunnel to delete
     * @throws Error if deletion fails
     */
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

    /**
     * Lists all available tunnels
     * @returns Array of tunnel information
     * @throws Error if listing fails
     */
    async listTunnels(): Promise<Array<{ id: string; name: string; connections?: Array<any>; url?: string }>> {
        try {
            return await this.apiService.listTunnels();
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to list tunnels: ${error}`);
            throw error;
        }
    }

    /**
     * Locates the cloudflared executable
     * @returns Path to the cloudflared executable
     * @throws Error if cloudflared is not found
     * @private
     */
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

    /**
     * Starts a tunnel with specified configuration
     * @param tunnelId ID of the tunnel to run
     * @param port Local port to tunnel
     * @returns Child process running the tunnel
     * @throws Error if tunnel start fails
     */
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

    /**
     * Cleans up resources for a stopped tunnel
     * @param tunnelId ID of the tunnel to clean up
     * @private
     */
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
        await this.tunnelLogger.logTunnelEvent(tunnelId, 'stopped', { preserveFocus: true });
        this._onTunnelEvent.fire({
            type: 'stop',
            tunnelId,
            message: 'Tunnel stopped'
        });
    }

    /**
     * Finds all cloudflared processes more efficiently
     * @returns Array of PIDs and their command lines
     * @private
     */
    private async findCloudflaredProcesses(): Promise<Array<{ pid: number; cmdline: string }>> {
        try {
            let processes: Array<{ pid: number; cmdline: string }> = [];
            
            if (process.platform === 'darwin' || process.platform === 'linux') {
                // Use more efficient command for Unix-like systems
                // pgrep is faster than ps aux | grep and more reliable
                const { stdout: pids } = await util.promisify(cp.exec)('pgrep -x cloudflared');
                
                if (pids.trim()) {
                    const pidList = pids.split('\n').filter(Boolean);
                    
                    // Get command lines for found PIDs using ps
                    // This is more efficient than getting all processes and filtering
                    if (pidList.length > 0) {
                        const { stdout: cmdlines } = await util.promisify(cp.exec)(
                            `ps -p ${pidList.join(',')} -o pid=,command=`
                        );
                        
                        processes = cmdlines.split('\n')
                            .filter(line => line.trim())
                            .map(line => {
                                const [pidStr, ...cmdParts] = line.trim().split(/\s+/);
                                return {
                                    pid: parseInt(pidStr),
                                    cmdline: cmdParts.join(' ')
                                };
                            });
                    }
                }
            } else if (process.platform === 'win32') {
                // Windows-specific optimization using tasklist
                const { stdout } = await util.promisify(cp.exec)(
                    'tasklist /FI "IMAGENAME eq cloudflared.exe" /FO CSV /NH'
                );
                
                const lines = stdout.split('\n').filter(Boolean);
                for (const line of lines) {
                    const [imageName, pidStr] = line.replace(/"/g, '').split(',');
                    if (imageName.toLowerCase() === 'cloudflared.exe') {
                        const pid = parseInt(pidStr);
                        // Get command line using wmic
                        try {
                            const { stdout: cmdline } = await util.promisify(cp.exec)(
                                `wmic process where ProcessId=${pid} get CommandLine /format:list`
                            );
                            const cmd = cmdline.split('\n')
                                .find(l => l.startsWith('CommandLine='))
                                ?.replace('CommandLine=', '')
                                ?.trim();
                            
                            if (cmd) {
                                processes.push({ pid, cmdline: cmd });
                            }
                        } catch (error) {
                            this.logger.debug(LogComponent.TUNNEL, `Failed to get command line for PID ${pid}`);
                        }
                    }
                }
            }

            this.logger.debug(LogComponent.TUNNEL, `Found ${processes.length} cloudflared processes`);
            return processes;
        } catch (error) {
            this.logger.debug(LogComponent.TUNNEL, 'No cloudflared processes found');
            return [];
        }
    }

    /**
     * Finds a specific tunnel process with improved accuracy
     * @param identifier Either a tunnel ID or port number
     * @returns Process info if found
     * @private
     */
    private async findTunnelProcess(identifier: string | number): Promise<Array<{ pid: number; cmdline: string }>> {
        const processes = await this.findCloudflaredProcesses();
        
        // If identifier is a number, look for port
        if (typeof identifier === 'number') {
            return processes.filter(p => {
                const cmdline = p.cmdline.toLowerCase();
                return cmdline.includes(`--url`) && 
                       cmdline.includes(`localhost:${identifier}`) &&
                       !cmdline.includes(`--token`); // Quick tunnels don't use token auth
            });
        }
        
        // If identifier is a string (tunnel ID), look for token-based auth
        // Validate tunnel ID format (UUID v4 format)
        const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidV4Regex.test(identifier)) {
            this.logger.warn(LogComponent.TUNNEL, `Invalid tunnel ID format: ${identifier}`);
            return [];
        }

        return processes.filter(p => {
            const cmdline = p.cmdline.toLowerCase();
            return cmdline.includes(`--token`) && // Must be using token auth
                   cmdline.includes(`run`) && // Must be a 'run' command
                   cmdline.includes(identifier.toLowerCase()); // Must include the exact tunnel ID
        });
    }

    /**
     * Kills a process with retries and force if needed
     * @param pid Process ID to kill
     * @param graceful Whether to attempt graceful shutdown first
     * @returns true if process was killed successfully
     * @private
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

    /**
     * Stops a running tunnel
     * @param tunnelId ID of the tunnel to stop
     * @throws Error if stop operation fails
     */
    async stopTunnel(tunnelId: string): Promise<void> {
        try {
            const runningTunnel = this.runningTunnels.get(tunnelId);
            if (!runningTunnel) {
                this.logger.warn(LogComponent.TUNNEL, `No running tunnel found for ID: ${tunnelId}`, { preserveFocus: true });
                return;
            }

            this.logger.info(LogComponent.TUNNEL, `Stopping TUNNEL: ${tunnelId}`, { preserveFocus: true });

            // Kill the process
            if (process.platform === 'win32') {
                try {
                    process.kill(runningTunnel.pid);
                } catch (error) {
                    this.logger.warn(LogComponent.TUNNEL, `Failed to kill process: ${error}`, { preserveFocus: true });
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
                    this.logger.warn(LogComponent.TUNNEL, `Failed to kill process: ${error}`, { preserveFocus: true });
                }
            }

            // Clean up resources
            await this.cleanupTunnelProcess(tunnelId);

            this.logger.info(LogComponent.TUNNEL, `TUNNEL: ${tunnelId} stopped`, { preserveFocus: true });
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to stop tunnel: ${error}`, { preserveFocus: true });
            throw error;
        }
    }

    /**
     * Checks the current status of a tunnel
     * @param tunnelId ID of the tunnel to check
     * @returns true if tunnel is active, false otherwise
     */
    async checkTunnelStatus(tunnelId: string): Promise<boolean> {
        try {
            const tunnel = await this.apiService.getTunnelInfo(tunnelId);
            return tunnel.status === 'active';
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to check tunnel status: ${error}`);
            return false;
        }
    }

    /**
     * Updates a tunnel's configuration
     * @param tunnelId ID of the tunnel to update
     * @param updates Configuration updates to apply
     * @throws Error if update fails
     */
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

    /**
     * Gets all currently running quick tunnels
     * @returns Array of quick tunnel information
     */
    async getQuickTunnels(): Promise<Array<{ port: number; url: string; tunnelUrl: string; name?: string }>> {
        const quickTunnels: Array<{ port: number; url: string; tunnelUrl: string; name?: string }> = [];
        
        for (const [tunnelId, tunnel] of this.runningTunnels.entries()) {
            if (tunnelId.startsWith('quick-')) {
                const portMatch = tunnelId.match(/quick-(\d+)-/);
                if (portMatch) {
                    const port = parseInt(portMatch[1], 10);
                    const url = `http://localhost:${port}`;
                    // Get the tunnel URL from the process output
                    const logFile = path.join(this.context.globalStoragePath, 'logs', 'tunnels', `${tunnelId}.log`);
                    try {
                        if (fs.existsSync(logFile)) {
                            const logContent = fs.readFileSync(logFile, 'utf8');
                            const urlMatch = logContent.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                            if (urlMatch) {
                                quickTunnels.push({
                                    port,
                                    url,
                                    tunnelUrl: urlMatch[0]
                                });
                            }
                        }
                    } catch (error) {
                        this.logger.error(LogComponent.TUNNEL, `Error reading quick tunnel log: ${error}`);
                    }
                }
            }
        }
        
        return quickTunnels;
    }

    /**
     * Cleans up all running tunnels
     * Called during extension deactivation
     */
    async cleanup(): Promise<void> {
        // Stop all running tunnels
        for (const [tunnelId] of this.runningTunnels) {
            await this.stopTunnel(tunnelId);
        }
    }

    /**
     * Creates a quick tunnel for temporary use
     * @param port Local port to tunnel
     * @returns Object containing local and tunnel URLs
     * @throws Error if quick tunnel creation fails
     */
    async createQuickTunnel(port: number): Promise<{ url: string; tunnelUrl: string } | null> {
        try {
            vscode.window.showInformationMessage(`Starting quick tunnel for port ${port}...`);
            this.logger.info(LogComponent.TUNNEL, `Starting quick tunnel for port ${port}`);

            // Find cloudflared
            this.logger.debug(LogComponent.TUNNEL, 'Looking for cloudflared executable...');
            const cloudflaredPath = await this.findCloudflaredPath();
            this.logger.debug(LogComponent.TUNNEL, `Found cloudflared at: ${cloudflaredPath}`);
            
            // Test cloudflared version
            try {
                const { stdout } = await util.promisify(cp.exec)(`${cloudflaredPath} --version`);
                this.logger.debug(LogComponent.TUNNEL, `Cloudflared version: ${stdout}`);
            } catch (error) {
                this.logger.error(LogComponent.TUNNEL, `Failed to get cloudflared version: ${error}`);
                throw new Error('Failed to verify cloudflared installation');
            }

            // Ensure port is a number and properly formatted
            const portNum = parseInt(port.toString(), 10);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                throw new Error('Invalid port number');
            }

            // Construct the local URL
            const localUrl = `http://localhost:${portNum}`;
            
            // Build the command arguments
            const args = ['tunnel', '--url', localUrl];
            const cmdString = `${cloudflaredPath} ${args.join(' ')}`;
            this.logger.info(LogComponent.TUNNEL, `Running command: ${cmdString}`);

            // Create process with full stdio
            const process = cp.spawn(cloudflaredPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false
            });

            if (!process.pid) {
                throw new Error('Failed to start cloudflared process');
            }

            this.logger.info(LogComponent.TUNNEL, `Started cloudflared process with PID: ${process.pid}`);

            // Create a unique ID for the quick tunnel
            const quickTunnelId = `quick-${portNum}-${Date.now()}`;
            const logStream = this.tunnelLogger.createLogStream(quickTunnelId);

            // Create a promise that resolves when we find the URL
            const urlPromise = new Promise<string>((resolve, reject) => {
                let outputBuffer = '';
                let errorBuffer = '';  // Add buffer for error messages

                // Function to check the entire buffer for a URL
                const checkBufferForUrl = () => {
                    const match = outputBuffer.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                    if (match) {
                        const tunnelUrl = match[0];
                        this.logger.info(LogComponent.TUNNEL, `Found quick tunnel URL: ${tunnelUrl}`);
                        
                        // Store the tunnel info immediately when we find the URL
                        if (!process.pid) {
                            reject(new Error('Process PID is undefined'));
                            return;
                        }

                        // Store the running tunnel first
                        this.runningTunnels.set(quickTunnelId, {
                            process,
                            pid: process.pid,
                            logStreams: [logStream]
                        });

                        // Then fire events and resolve
                        this._onTunnelEvent.fire({
                            type: 'start',
                            tunnelId: quickTunnelId,
                            message: `Quick tunnel started for port ${portNum}`
                        });
                        vscode.window.showInformationMessage(`Quick tunnel is running at ${tunnelUrl}`);
                        resolve(tunnelUrl);
                        return true;
                    }
                    return false;
                };

                // Process stdout to find the tunnel URL
                process.stdout.on('data', (data: Buffer) => {
                    const output = data.toString();
                    outputBuffer += output;
                    logStream.write(output);

                    this.logger.debug(LogComponent.TUNNEL, `Quick tunnel stdout received ${data.length} bytes`);
                    checkBufferForUrl();
                });

                // Process stderr for error messages and logging
                process.stderr.on('data', (data: Buffer) => {
                    const output = data.toString();
                    errorBuffer += output;  // Store error messages
                    outputBuffer += output;
                    logStream.write(output);
                    this.logger.debug(LogComponent.TUNNEL, `Quick tunnel stderr: ${output}`);
                });

                // Handle process events
                process.on('error', (error) => {
                    this.logger.error(LogComponent.TUNNEL, `Quick tunnel process error: ${error}`);
                    reject(error);
                });

                process.on('exit', (code, signal) => {
                    this.logger.info(
                        LogComponent.TUNNEL,
                        `Quick tunnel process exited with code ${code}, signal ${signal}`
                    );
                    if (code !== 0) {
                        // Log the error buffer if we have one
                        if (errorBuffer) {
                            this.logger.error(LogComponent.TUNNEL, `Error output from cloudflared:\n${errorBuffer}`);
                            
                            // Check for specific error types
                            if (errorBuffer.includes('429 Too Many Requests')) {
                                vscode.window.showErrorMessage(
                                    'Rate limit exceeded for quick tunnels. Please wait a few minutes before trying again.',
                                    { detail: 'Cloudflare limits the number of quick tunnels you can create in a short time period.' }
                                );
                                reject(new Error('Rate limit exceeded for quick tunnels'));
                                return;
                            }
                            
                            // Check for port already in use
                            if (errorBuffer.includes('bind: address already in use')) {
                                vscode.window.showErrorMessage(
                                    `Port ${portNum} is already in use. Please choose a different port.`,
                                    { detail: 'Another application or tunnel might be using this port.' }
                                );
                                reject(new Error(`Port ${portNum} is already in use`));
                                return;
                            }

                            // Check for connection errors
                            if (errorBuffer.includes('connection refused') || errorBuffer.includes('cannot connect to')) {
                                vscode.window.showErrorMessage(
                                    'Failed to connect to Cloudflare. Please check your internet connection.',
                                    { detail: 'Make sure you have a stable internet connection and try again.' }
                                );
                                reject(new Error('Failed to connect to Cloudflare'));
                                return;
                            }
                        }
                        
                        // Generic error with the full error message
                        const errorMessage = errorBuffer ? errorBuffer.trim() : 'Unknown error occurred';
                        vscode.window.showErrorMessage(
                            'Failed to create quick tunnel',
                            { detail: errorMessage }
                        );
                        reject(new Error(`Quick tunnel process exited with code ${code}${errorBuffer ? `: ${errorBuffer.trim()}` : ''}`));
                    }
                });

                // Set a timeout for URL detection
                const timeout = setTimeout(() => {
                    this.logger.error(LogComponent.TUNNEL, 'Timed out waiting for tunnel URL. Full output buffer:', outputBuffer);
                    if (errorBuffer) {
                        this.logger.error(LogComponent.TUNNEL, 'Error output:', errorBuffer);
                    }
                    reject(new Error('Timed out waiting for quick tunnel URL'));
                }, 5000); // 5 seconds timeout

                // Check the buffer periodically in case we missed the URL in the event handlers
                const interval = setInterval(() => {
                    if (checkBufferForUrl()) {
                        clearInterval(interval);
                        clearTimeout(timeout);
                    }
                }, 100); // Check every 100ms

                // Clean up interval on reject/resolve
                process.on('exit', () => {
                    clearInterval(interval);
                    clearTimeout(timeout);
                });
            });

            // Wait for the URL
            const tunnelUrl = await urlPromise;

            return {
                url: localUrl,
                tunnelUrl
            };
        } catch (error) {
            // Clean up on error
            await this.stopQuickTunnel(port);
            this.logger.error(LogComponent.TUNNEL, `Failed to create quick tunnel: ${error}`);
            throw error;
        }
    }

    /**
     * Stops a quick tunnel
     * @param port Port number of the quick tunnel to stop
     */
    async stopQuickTunnel(port: number): Promise<void> {
        // Find the quick tunnel process for this port
        const quickTunnelId = Array.from(this.runningTunnels.entries())
            .find(([id, _]) => id.startsWith(`quick-${port}-`))?.[0];

        if (quickTunnelId) {
            await this.stopTunnel(quickTunnelId);
        }
    }
} 