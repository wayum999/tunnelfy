/**
 * CloudflaredService - Core Service for Cloudflare Tunnel Management
 * 
 * This service is responsible for all interactions with the cloudflared CLI tool.
 * It handles:
 * 1. Tunnel creation and management (both persistent and quick tunnels)
 * 2. Certificate and token management
 * 3. Running and monitoring tunnel processes
 * 4. Event emission for tunnel status changes
 * 
 * Key Features:
 * - Supports both persistent tunnels (with custom domains) and quick tunnels
 * - Manages tunnel tokens securely
 * - Provides real-time tunnel status monitoring
 * - Handles graceful cleanup of tunnel processes
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Logger, LogComponent } from '../utils/logger';
import { TokenService } from './tokenService';
import { CloudflareApiService } from './cloudflareApiService';
import { ProfileManager } from './profileManager';

const exec = util.promisify(cp.exec);

export class CloudflaredService {
    private readonly cloudflaredDir: string;
    private readonly logger: Logger;
    private readonly tokenService: TokenService;
    public readonly apiService: CloudflareApiService;
    private readonly runningTunnels: Map<string, cp.ChildProcess> = new Map();
    
    // Event emitter for tunnel status changes
    private readonly _onTunnelEvent = new vscode.EventEmitter<{
        type: 'url' | 'status' | 'error' | 'config';
        tunnelId: string;
        data: any;
    }>();
    readonly onTunnelEvent = this._onTunnelEvent.event;

    /**
     * Initializes the CloudflaredService instance
     * @param context - The VS Code extension context
     * @param profileManager - The profile manager instance
     */
    constructor(
        private context: vscode.ExtensionContext,
        private profileManager: ProfileManager
    ) {
        this.cloudflaredDir = path.join(os.homedir(), '.cloudflared');
        this.logger = Logger.getInstance();
        this.tokenService = new TokenService(context);
        this.apiService = new CloudflareApiService(context, profileManager);
        this.logger.info(LogComponent.TUNNEL, 'CloudflaredService initialized', { preserveFocus: true });
        this.logger.debug(LogComponent.TUNNEL, `Using cloudflared directory: ${this.cloudflaredDir}`, { preserveFocus: true });
    }

    /**
     * Gets the path to the Cloudflare certificate file
     * This cert is required for authentication with Cloudflare
     */
    private get certPath(): string {
        return path.join(this.cloudflaredDir, 'cert.pem');
    }

    /**
     * Verifies that the certificate file exists and is valid
     * This is crucial for authentication with Cloudflare
     * Throws an error if the cert is missing or invalid
     */
    private async verifyCertFile(): Promise<void> {
        const certPath = this.certPath;
        if (!fs.existsSync(certPath)) {
            this.logger.error(LogComponent.TUNNEL, `Certificate file not found: ${certPath}`, undefined, { preserveFocus: true });
            throw new Error('No certificate file found. Please login or switch to a valid profile.');
        }
        try {
            fs.accessSync(certPath, fs.constants.R_OK);
            const stats = fs.statSync(certPath);
            if (stats.size === 0) {
                throw new Error('Certificate file is empty');
            }
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Certificate file not accessible`, error, { preserveFocus: true });
            throw new Error('Certificate file exists but is not accessible. Please check file permissions.');
        }
    }

    /**
     * Executes a cloudflared CLI command
     * Handles environment setup and error logging
     * @param command - The cloudflared command to execute
     * @param silent - If true, suppresses output window focus (default: false)
     */
    private async runCloudflaredCommand(command: string, silent: boolean = false): Promise<{ stdout: string; stderr: string }> {
        try {
            // Add cert path to environment if needed
            const env = { ...process.env };
            if (!command.includes('--token')) {
                env.TUNNEL_ORIGIN_CERT = this.certPath;
            }

            if (!silent) {
                this.logger.debug(LogComponent.COMMAND, `Running command: ${command}`, { preserveFocus: true });
            }

            const { stdout, stderr } = await util.promisify(cp.exec)(command, { env });

            if (stderr && !silent) {
                this.logger.warn(LogComponent.COMMAND, 'Command stderr:', { preserveFocus: true });
            }

            // For JSON responses, just log that we received data
            if (!silent) {
                if (stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
                    this.logger.debug(LogComponent.COMMAND, 'Command returned JSON data', { preserveFocus: true });
                } else {
                    this.logger.debug(LogComponent.COMMAND, 'Command output:', { preserveFocus: true });
                }
            }

            return { stdout, stderr };
        } catch (error) {
            const err = error as cp.ExecException;
            if (!silent) {
                this.logger.error(LogComponent.COMMAND, `Command failed: ${command}`, err, { preserveFocus: true });
            }
            throw err;
        }
    }

    /**
     * Checks if cloudflared is installed on the system
     * @returns True if cloudflared is installed, false otherwise
     */
    async checkInstallation(): Promise<boolean> {
        try {
            const { stdout } = await this.runCloudflaredCommand('cloudflared --version', true);
            const isInstalled = stdout.toLowerCase().includes('cloudflared version');
            this.logger.debug(LogComponent.TUNNEL, `Cloudflared installation check: ${isInstalled}`, { preserveFocus: true });
            return isInstalled;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to check cloudflared installation', error, { preserveFocus: true });
            return false;
        }
    }

    /**
     * Initiates the login process with Cloudflare
     * Opens the login URL in the default browser
     * @returns True if the login process was initiated successfully, false otherwise
     */
    async login(): Promise<boolean> {
        try {
            // Run cloudflared login and capture the URL
            const { stdout } = await this.runCloudflaredCommand('cloudflared tunnel login');
            
            // Extract the login URL from stdout
            const urlMatch = stdout.match(/https:\/\/dash\.cloudflare\.com\/[^\s]*/);
            if (!urlMatch) {
                throw new Error('Could not find login URL in cloudflared output');
            }

            // Open the URL in the browser
            await vscode.env.openExternal(vscode.Uri.parse(urlMatch[0]));
            return true;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to login:', error);
            return false;
        }
    }

    /**
     * Creates a new tunnel with the given name
     * @param name - The name of the tunnel to create
     * @returns True if the tunnel was created successfully, false otherwise
     */
    async createTunnel(name: string): Promise<boolean> {
        try {
            await this.verifyCertFile();
            await this.runCloudflaredCommand(`cloudflared tunnel create ${name}`);
            return true;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to create tunnel:', error);
            return false;
        }
    }

    /**
     * Deletes a tunnel with the given ID
     * @param tunnelId - The ID of the tunnel to delete
     * @returns True if the tunnel was deleted successfully, false otherwise
     */
    async deleteTunnel(tunnelId: string): Promise<boolean> {
        try {
            await this.runCloudflaredCommand(`cloudflared tunnel delete ${tunnelId}`);
            return true;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to delete tunnel:', error);
            return false;
        }
    }

    /**
     * Lists all tunnels
     * @returns An array of tunnel objects
     */
    async listTunnels(): Promise<Array<{ id: string; name: string; connections?: Array<any>; url?: string }>> {
        try {
            this.logger.debug(LogComponent.TUNNEL, 'Listing tunnels...', { preserveFocus: true });
            const tunnels = await this.apiService.listTunnels();
            this.logger.debug(LogComponent.TUNNEL, `Found ${tunnels.length} tunnels`, { preserveFocus: true });
            
            // Only log individual tunnels at debug level
            tunnels.forEach(tunnel => {
                this.logger.debug(LogComponent.TUNNEL, `Found tunnel: ${tunnel.name} (${tunnel.id})`, { preserveFocus: true });
            });
            
            return tunnels;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to list tunnels', error, { preserveFocus: true });
            return [];
        }
    }

    /**
     * Routes a tunnel to a specific hostname
     * @param tunnelId - The ID of the tunnel to route
     * @param hostname - The hostname to route to
     * @returns True if the tunnel was routed successfully, false otherwise
     */
    async routeTunnel(tunnelId: string, hostname: string): Promise<boolean> {
        try {
            await this.runCloudflaredCommand(`cloudflared tunnel route dns ${tunnelId} ${hostname}`);
            return true;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to route tunnel:', error);
            return false;
        }
    }

    /**
     * Runs a tunnel in the background
     * @param tunnelId - The ID of the tunnel to run
     * @param port - The port to run the tunnel on
     * @param hostname - The hostname to run the tunnel on (optional)
     * @returns The child process running the tunnel
     */
    async runTunnel(tunnelId: string, port: number, hostname?: string): Promise<cp.ChildProcess> {
        this.logger.info(LogComponent.TUNNEL, `Running tunnel ${tunnelId} on port ${port}`);
        
        try {
            // Get the token first
            this.logger.debug(LogComponent.TUNNEL, 'Getting tunnel token...');
            const token = await this.getTunnelToken(tunnelId);
            if (!token) {
                const errorMessage = 'Failed to get tunnel token';
                this.logger.error(LogComponent.TUNNEL, errorMessage);
                this._onTunnelEvent.fire({
                    type: 'error',
                    tunnelId,
                    data: errorMessage
                });
                throw new Error(errorMessage);
            }
            this.logger.debug(LogComponent.TUNNEL, `Got token for tunnel ${tunnelId}`);

            // Fix the origin service URL: default to http://localhost:<port> if hostname is not provided
            if (!hostname) {
                hostname = `http://localhost:${port}`;
            } else {
                if (!hostname.startsWith('http://') && !hostname.startsWith('https://')) {
                    hostname = `http://${hostname}`;
                }
            }

            // Log the resolved origin URL for debugging
            this.logger.debug(LogComponent.TUNNEL, `Resolved origin URL: ${hostname}`);

            // Build command arguments
            const args = ['tunnel', 'run'];
            
            // Add token
            args.push('--token', token);

            // Add URL (localhost with port)
            args.push('--url', hostname);

            this.logger.debug(LogComponent.COMMAND, `Running cloudflared with args: ${args.join(' ')}`);

            // Create log files for stdout and stderr
            const logDir = path.join(this.context.extensionPath, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const stdoutLog = path.join(logDir, `tunnel-${tunnelId}-stdout.log`);
            const stderrLog = path.join(logDir, `tunnel-${tunnelId}-stderr.log`);
            const stdout = fs.openSync(stdoutLog, 'a');
            const stderr = fs.openSync(stderrLog, 'a');

            // Run tunnel in the background
            this.logger.debug(LogComponent.TUNNEL, 'Spawning cloudflared process...');
            
            const tunnel = cp.spawn('cloudflared', args, {
                detached: true,
                stdio: ['ignore', stdout, stderr],
                env: process.env // No need for cert.pem when using token
            });

            // Unref the process so it can run independently
            tunnel.unref();

            this.logger.debug(LogComponent.TUNNEL, 'Cloudflared process spawned and detached');

            // Store the tunnel process
            this.runningTunnels.set(tunnelId, tunnel);

            // Set up file watchers for the log files
            const stdoutWatcher = fs.watch(stdoutLog, (eventType) => {
                if (eventType === 'change') {
                    const content = fs.readFileSync(stdoutLog, 'utf8');
                    const lines = content.split('\n');
                    for (const line of lines) {
                        if (!line) continue;
                        
                        this.logger.debug(LogComponent.TUNNEL, `Tunnel stdout: ${line}`);

                        // Look for connection status
                        const connMatch = line.match(/Registered tunnel connection .* location=(\w+)/);
                        if (connMatch) {
                            this._onTunnelEvent.fire({
                                type: 'status',
                                tunnelId,
                                data: {
                                    status: 'connected',
                                    location: connMatch[1]
                                }
                            });
                            
                            // Refresh tunnel list after successful connection
                            this.logger.debug(LogComponent.TUNNEL, 'Tunnel connected successfully, refreshing tunnel list...');
                            this.listTunnels().catch(err => {
                                this.logger.error(LogComponent.TUNNEL, 'Failed to refresh tunnel list:', err);
                            });
                        }

                        // Look for error messages
                        if (line.toLowerCase().includes('error')) {
                            this._onTunnelEvent.fire({
                                type: 'error',
                                tunnelId,
                                data: { error: line }
                            });
                        }
                    }
                }
            });

            const stderrWatcher = fs.watch(stderrLog, (eventType) => {
                if (eventType === 'change') {
                    const content = fs.readFileSync(stderrLog, 'utf8');
                    const lines = content.split('\n');
                    for (const line of lines) {
                        if (!line) continue;
                        this.logger.error(LogComponent.TUNNEL, `Tunnel stderr: ${line}`);
                        this._onTunnelEvent.fire({
                            type: 'error',
                            tunnelId,
                            data: { error: line }
                        });
                    }
                }
            });

            // Clean up watchers when process exits
            tunnel.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                const message = `Tunnel process exited with code ${code} and signal ${signal}`;
                this.logger.debug(LogComponent.TUNNEL, message);
                stdoutWatcher.close();
                stderrWatcher.close();
                
                // Remove from running tunnels map
                this.runningTunnels.delete(tunnelId);

                if (code !== 0) {
                    this._onTunnelEvent.fire({
                        type: 'error',
                        tunnelId,
                        data: { error: message }
                    });
                }
                
                // Refresh tunnel list after process exit
                this.logger.debug(LogComponent.TUNNEL, 'Tunnel process exited, refreshing tunnel list...');
                this.listTunnels().catch(err => {
                    this.logger.error(LogComponent.TUNNEL, 'Failed to refresh tunnel list:', err);
                });
            });

            // Handle process errors
            tunnel.on('error', (error) => {
                const message = `Tunnel process error: ${error.message}`;
                this.logger.error(LogComponent.TUNNEL, message);
                this._onTunnelEvent.fire({
                    type: 'error',
                    tunnelId,
                    data: { error: message }
                });
            });

            return tunnel;
        } catch (err) {
            const error = err instanceof Error ? err : new Error('Unknown error occurred');
            this.logger.error(LogComponent.TUNNEL, 'Failed to run tunnel:', error);
            this._onTunnelEvent.fire({
                type: 'error',
                tunnelId,
                data: { error: error.message }
            });
            throw error;
        }
    }

    /**
     * Gets the token for a tunnel
     * @param tunnelId - The ID of the tunnel to get the token for
     * @returns The token for the tunnel, or null if not found
     */
    async getTunnelToken(tunnelId: string): Promise<string | null> {
        try {
            this.logger.debug(LogComponent.TUNNEL, `Getting token for tunnel ${tunnelId}`, { preserveFocus: true });
            
            try {
                // First try to get from secure storage
                const token = await this.tokenService.getTunnelToken(tunnelId);
                if (token) {
                    this.logger.debug(LogComponent.TUNNEL, 'Found token in storage', { preserveFocus: true });
                    return token;
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.debug(LogComponent.TUNNEL, `Failed to get token from storage: ${errorMessage}`, { preserveFocus: true });
                // Continue to try getting from cloudflared
            }

            this.logger.debug(LogComponent.TUNNEL, 'Getting token from cloudflared', { preserveFocus: true });
            // Get from cloudflared and store it
            const { stdout } = await this.runCloudflaredCommand(`cloudflared tunnel token ${tunnelId}`);
            const token = stdout.trim();
            
            if (token) {
                this.logger.debug(LogComponent.TUNNEL, 'Got token from cloudflared, storing it', { preserveFocus: true });
                try {
                    await this.tokenService.storeTunnelToken(tunnelId, token);
                } catch (storeError) {
                    const errorMessage = storeError instanceof Error ? storeError.message : String(storeError);
                    this.logger.error(LogComponent.TUNNEL, `Failed to store token: ${errorMessage}`, undefined, { preserveFocus: true });
                    // Continue even if we can't store it
                }
                return token;
            } else {
                this.logger.error(LogComponent.TUNNEL, 'Got empty token from cloudflared', undefined, { preserveFocus: true });
                return null;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(LogComponent.TUNNEL, `Failed to get tunnel token: ${errorMessage}`, undefined, { preserveFocus: true });
            return null;
        }
    }

    /**
     * Stops a tunnel
     * @param tunnelId - The ID of the tunnel to stop
     */
    async stopTunnel(tunnelId: string): Promise<void> {
        this.logger.info(LogComponent.TUNNEL, `Stopping tunnel ${tunnelId}`, { preserveFocus: true });
        try {
            // Clean and validate tunnel ID
            const cleanTunnelId = String(tunnelId).trim();
            if (!cleanTunnelId) {
                throw new Error('Empty tunnel ID provided');
            }
            
            // First try to terminate the process if we have it
            const tunnelProcess = this.runningTunnels.get(cleanTunnelId);
            if (tunnelProcess) {
                this.logger.debug(LogComponent.TUNNEL, 'Found running tunnel process, terminating...', { preserveFocus: true });
                
                // Try SIGTERM first for graceful shutdown
                if (tunnelProcess.pid) {
                    this.logger.debug(LogComponent.TUNNEL, `Sending SIGTERM to process group ${-tunnelProcess.pid}`, { preserveFocus: true });
                    process.kill(-tunnelProcess.pid, 'SIGTERM');
                } else {
                    this.logger.error(LogComponent.TUNNEL, 'Tunnel process PID is undefined; cannot send SIGTERM', undefined, { preserveFocus: true });
                }
                
                // Give it some time to terminate gracefully
                await new Promise<void>((resolve) => {
                    const timeout = setTimeout(() => {
                        // If still running after timeout, force kill
                        if (!tunnelProcess.killed) {
                            this.logger.warn(LogComponent.TUNNEL, 'Tunnel process did not terminate gracefully, force killing...', { preserveFocus: true });
                            if (tunnelProcess.pid) {
                                process.kill(-tunnelProcess.pid, 'SIGKILL');
                            }
                        }
                        resolve();
                    }, 5000);

                    tunnelProcess.once('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });

                this.runningTunnels.delete(cleanTunnelId);
                this.logger.info(LogComponent.TUNNEL, `Tunnel ${cleanTunnelId} stopped`, { preserveFocus: true });
            } else {
                this.logger.warn(LogComponent.TUNNEL, `No running process found for tunnel ${cleanTunnelId}`, { preserveFocus: true });
            }
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to stop tunnel', error, { preserveFocus: true });
            throw error;
        }
    }

    /**
     * Gets information about a tunnel
     * @param tunnelId - The ID of the tunnel to get information about
     * @returns The tunnel information, or null if not found
     */
    async getTunnelInfo(tunnelId: string): Promise<any> {
        try {
            const { stdout } = await this.runCloudflaredCommand('cloudflared tunnel list --output json');
            const tunnels = JSON.parse(stdout);
            return tunnels.find((t: any) => t.id === tunnelId);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to get tunnel info:', error);
            return null;
        }
    }

    /**
     * Checks the status of a tunnel
     * @param tunnelId - The ID of the tunnel to check the status of
     * @returns True if the tunnel is running, false otherwise
     */
    async checkTunnelStatus(tunnelId: string): Promise<boolean> {
        try {
            // Get list of all tunnels with their status
            const { stdout } = await this.runCloudflaredCommand('cloudflared tunnel list -o json');
            console.log('Tunnel list output:', stdout);
            
            try {
                const tunnels = JSON.parse(stdout);
                const tunnel = tunnels.find((t: any) => t.id === tunnelId);
                
                if (tunnel) {
                    // Check if the tunnel has any running connections
                    if (tunnel.connections && tunnel.connections.length > 0) {
                        return true;
                    }
                    
                    // Also check the status field if available
                    if (tunnel.status === 'active' || tunnel.status === 'running') {
                        return true;
                    }
                }
            } catch (parseError) {
                this.logger.error(LogComponent.TUNNEL, 'Error parsing tunnel list:', parseError);
            }

            // Fallback to checking connections directly
            try {
                const { stdout: connOutput } = await this.runCloudflaredCommand(`cloudflared tunnel info ${tunnelId}`);
                console.log(`Tunnel ${tunnelId} info output:`, connOutput);
                return connOutput.includes('Active connectors') || 
                       connOutput.includes('Connection ID');
            } catch (connError) {
                this.logger.error(LogComponent.TUNNEL, `Could not get tunnel info: ${connError}`);
            }

            return false;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Error checking tunnel status: ${error}`);
            return false;
        }
    }

    /**
     * Cleans up all tunnels
     */
    async cleanupTunnels(): Promise<void> {
        try {
            await this.runCloudflaredCommand('cloudflared tunnel cleanup');
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to cleanup tunnels:', error);
        }
    }

    /**
     * Checks if a port is available
     * @param port - The port to check
     * @returns True if the port is available, false otherwise
     */
    private async isPortAvailable(port: number): Promise<boolean> {
        try {
            const { stdout } = await exec(`lsof -i:${port}`);
            return stdout.trim() === ''; // Port is available if no process is using it
        } catch (error) {
            // lsof exits with code 1 if no process is using the port
            return true;
        }
    }

    /**
     * Creates a quick tunnel
     * @param port - The port to run the tunnel on
     * @param hostname - The hostname to run the tunnel on (optional)
     * @returns The URL of the tunnel, or null if creation failed
     */
    async createQuickTunnel(port: number, hostname?: string): Promise<{ url: string; tunnelUrl: string } | null> {
        try {
            this.logger.debug(LogComponent.TUNNEL, `Starting quick tunnel creation for port ${port}`);
            
            // First check if cloudflared is installed
            const isInstalled = await this.checkInstallation();
            if (!isInstalled) {
                throw new Error('cloudflared is not installed. Please install it first.');
            }
            
            // Check if port is available
            const portAvailable = await this.isPortAvailable(port);
            if (!portAvailable) {
                throw new Error(`Port ${port} is already in use. Please choose a different port.`);
            }
            
            // Verify cert file next
            await this.verifyCertFile();
            this.logger.debug(LogComponent.TUNNEL, 'Certificate verified');

            // Run tunnel in the background
            const args = ['tunnel', '--url', `http://localhost:${port}`];
            if (hostname) {
                args.push('--hostname', hostname);
            }
            
            this.logger.debug(LogComponent.COMMAND, `Spawning cloudflared with args: ${args.join(' ')}`);
            
            const tunnel = cp.spawn('cloudflared', args, {
                stdio: 'pipe',
                env: {
                    ...process.env,
                    TUNNEL_ORIGIN_CERT: this.certPath,
                    NO_AUTOUPDATE: '1', // Prevent autoupdate during quick tunnel
                }
            });

            // Return a promise that resolves when we get the tunnel URL
            return new Promise((resolve, reject) => {
                let output = '';
                let errorOutput = '';
                let tunnelUrl = '';
                let localUrl = `http://localhost:${port}`;
                let timeoutId: NodeJS.Timeout;

                this.logger.debug(LogComponent.TUNNEL, 'Setting up tunnel output handlers');

                tunnel.stdout?.on('data', (data: Buffer) => {
                    const line = data.toString();
                    output += line;
                    this.logger.debug(LogComponent.TUNNEL, `Quick tunnel stdout: ${line}`);

                    // Look for the tunnel URL in the output
                    const tunnelMatch = line.match(/https:\/\/[^\s]+\.trycloudflare\.com/);
                    if (tunnelMatch && !tunnelUrl) {
                        tunnelUrl = tunnelMatch[0];
                        this.logger.debug(LogComponent.TUNNEL, `Found tunnel URL: ${tunnelUrl}`);
                        
                        clearTimeout(timeoutId);
                        resolve({
                            url: localUrl,
                            tunnelUrl: tunnelUrl
                        });
                    }
                });

                tunnel.stderr?.on('data', (data: Buffer) => {
                    const line = data.toString();
                    errorOutput += line;
                    this.logger.debug(LogComponent.TUNNEL, `Quick tunnel stderr: ${line}`);
                    
                    // Also look for tunnel URL in stderr (sometimes cloudflared outputs to stderr)
                    const tunnelMatch = line.match(/https:\/\/[^\s]+\.trycloudflare\.com/);
                    if (tunnelMatch && !tunnelUrl) {
                        tunnelUrl = tunnelMatch[0];
                        this.logger.debug(LogComponent.TUNNEL, `Found tunnel URL in stderr: ${tunnelUrl}`);
                        
                        clearTimeout(timeoutId);
                        resolve({
                            url: localUrl,
                            tunnelUrl: tunnelUrl
                        });
                    }

                    // Check for rate limit errors
                    if (line.includes('429 Too Many Requests')) {
                        clearTimeout(timeoutId);
                        reject(new Error('Rate limit exceeded for quick tunnels. Please wait a few minutes and try again, or consider using a named tunnel instead.'));
                        return;
                    }

                    // Check for common error messages
                    if (line.includes('error')) {
                        this.logger.error(LogComponent.TUNNEL, `Quick tunnel error in stderr: ${line}`);
                    }
                });

                tunnel.on('error', (error) => {
                    this.logger.error(LogComponent.TUNNEL, 'Quick tunnel error:', error);
                    clearTimeout(timeoutId);
                    reject(new Error(`Quick tunnel failed to start: ${error.message}`));
                });

                tunnel.on('exit', (code) => {
                    this.logger.debug(LogComponent.TUNNEL, `Quick tunnel process exited with code ${code}`);
                    if (code !== 0 && !tunnelUrl) {
                        clearTimeout(timeoutId);
                        // Handle rate limit errors from the exit code
                        if (errorOutput.includes('429 Too Many Requests')) {
                            reject(new Error('Rate limit exceeded for quick tunnels. Please wait a few minutes and try again, or consider using a named tunnel instead.'));
                            return;
                        }
                        const errorMsg = errorOutput ? 
                            `Quick tunnel failed: ${errorOutput}` : 
                            `Quick tunnel exited with code ${code}`;
                        reject(new Error(errorMsg));
                    }
                });

                // Timeout after 30 seconds
                timeoutId = setTimeout(() => {
                    this.logger.error(LogComponent.TUNNEL, 'Timeout waiting for quick tunnel URL');
                    tunnel.kill();
                    reject(new Error('Timeout waiting for quick tunnel URL'));
                }, 30000);
            });
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to create quick tunnel:', error);
            throw error; // Re-throw to let caller handle the error
        }
    }

    /**
     * Stops a quick tunnel
     * @param port - The port the tunnel is running on
     * @returns True if the tunnel was stopped successfully, false otherwise
     */
    async stopQuickTunnel(port: number): Promise<boolean> {
        try {
            // Find and kill the cloudflared process running on this port
            const { stdout } = await exec(`ps aux | grep "cloudflared tunnel.*:${port}" | grep -v grep`);
            const lines = stdout.split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length > 1) {
                    const pid = parts[1];
                    await exec(`kill ${pid}`);
                }
            }
            return true;
        } catch (error) {
            // If the grep command fails, it means no process was found, which is fine
            if (error instanceof Error && error.message.includes('Command failed')) {
                return true;
            }
            this.logger.error(LogComponent.TUNNEL, 'Failed to stop quick tunnel:', error);
            return false;
        }
    }
}