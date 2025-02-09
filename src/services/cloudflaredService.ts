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

interface CloudflareTunnel {
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

const exec = util.promisify(cp.exec);

export class CloudflaredService {
    private readonly cloudflaredDir: string;
    private readonly logger: Logger;
    private readonly tokenService: TokenService;
    public readonly apiService: CloudflareApiService;
    private readonly runningTunnels: Map<string, { process: cp.ChildProcess; pid: number; logStreams: fs.WriteStream[] }> = new Map();
    private readonly platform = process.platform;
    
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
     * Checks if cloudflared is installed
     */
    private async isCloudflaredInstalled(): Promise<boolean> {
        try {
            await exec('cloudflared --version');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Gets the installation command based on OS
     */
    private getInstallCommand(): { command: string; method: string } | null {
        switch (this.platform) {
            case 'darwin':
                return { command: 'brew install cloudflared', method: 'Homebrew' };
            case 'win32':
                return { command: 'winget install Cloudflare.cloudflared', method: 'Winget' };
            case 'linux':
                // For Linux, we'll need to determine the specific distribution
                if (fs.existsSync('/etc/debian_version')) {
                    return {
                        command: 'curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared && sudo mv cloudflared /usr/local/bin',
                        method: 'Debian/Ubuntu'
                    };
                } else if (fs.existsSync('/etc/redhat-release')) {
                    return { command: 'dnf install cloudflared', method: 'RHEL/Fedora' };
                } else if (fs.existsSync('/etc/arch-release')) {
                    return { command: 'yay -S cloudflared-bin', method: 'Arch Linux' };
                }
                return null;
            default:
                return null;
        }
    }

    /**
     * Prompts user to install cloudflared
     */
    private async promptInstallCloudflared(): Promise<boolean> {
        const installInfo = this.getInstallCommand();
        if (!installInfo) {
            const result = await vscode.window.showWarningMessage(
                'Cloudflared is not installed. Please install it manually from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation',
                'Open Installation Guide'
            );
            if (result === 'Open Installation Guide') {
                vscode.env.openExternal(vscode.Uri.parse('https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation'));
            }
            return false;
        }

        const result = await vscode.window.showWarningMessage(
            `Cloudflared is required but not installed. Would you like to install it using ${installInfo.method}?`,
            'Install',
            'I\'ll do it myself',
            'Show Installation Guide'
        );

        if (result === 'Install') {
            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Installing cloudflared...',
                    cancellable: false
                }, async () => {
                    await exec(installInfo.command);
                });
                vscode.window.showInformationMessage('Cloudflared installed successfully!');
                return true;
            } catch (error) {
                this.logger.error(LogComponent.TUNNEL, 'Failed to install cloudflared:', error);
                vscode.window.showErrorMessage('Failed to install cloudflared. Please install it manually.');
                return false;
            }
        } else if (result === 'Show Installation Guide') {
            vscode.env.openExternal(vscode.Uri.parse('https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation'));
        }
        return false;
    }

    /**
     * Ensures cloudflared is installed
     */
    private async ensureCloudflaredInstalled(): Promise<boolean> {
        const installed = await this.isCloudflaredInstalled();
        if (!installed) {
            return await this.promptInstallCloudflared();
        }
        return true;
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
     * Creates a new tunnel
     */
    async createTunnel(name: string): Promise<CloudflareTunnel> {
        try {
            const tunnel = await this.apiService.createTunnel(name);
            this.logger.info(LogComponent.TUNNEL, `Created tunnel: ${name} (${tunnel.id})`);
            return tunnel;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to create tunnel ${name}:`, error);
            throw error;
        }
    }

    /**
     * Gets the token for a tunnel
     */
    async getTunnelToken(tunnelId: string): Promise<string> {
        try {
            return await this.apiService.getTunnelToken(tunnelId);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to get token for tunnel ${tunnelId}:`, error);
            throw error;
        }
    }

    /**
     * Gets detailed information about a specific tunnel
     */
    async getTunnelInfo(tunnelId: string): Promise<any> {
        try {
            return await this.apiService.getTunnelInfo(tunnelId);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to get tunnel info for ${tunnelId}:`, error);
            throw error;
        }
    }

    /**
     * Deletes a tunnel
     */
    async deleteTunnel(tunnelId: string): Promise<void> {
        try {
            await this.apiService.deleteTunnel(tunnelId);
            this.logger.info(LogComponent.TUNNEL, `Deleted tunnel: ${tunnelId}`);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to delete tunnel ${tunnelId}:`, error);
            throw error;
        }
    }

    /**
     * Lists all tunnels
     */
    async listTunnels(): Promise<Array<{ id: string; name: string; connections?: Array<any>; url?: string }>> {
        try {
            return await this.apiService.listTunnels();
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to list tunnels:', error);
            throw error;
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
     * Runs a tunnel in the background using token-based authentication
     */
    async runTunnel(tunnelId: string, port: number): Promise<cp.ChildProcess> {
        try {
            // First check if cloudflared is installed
            const isInstalled = await this.ensureCloudflaredInstalled();
            if (!isInstalled) {
                throw new Error('Cloudflared is required to run tunnels. Please install it and try again.');
            }

            // Get tunnel info first to include name in logs
            const tunnelInfo = await this.getTunnelInfo(tunnelId);
            if (!tunnelInfo || !tunnelInfo.name) {
                throw new Error('Failed to get tunnel information');
            }

            // Get the token
            this.logger.debug(LogComponent.TUNNEL, 'Getting tunnel token...', { preserveFocus: true });
            const token = await this.getTunnelToken(tunnelId);
            if (!token) {
                const errorMessage = 'Failed to get tunnel token';
                this.logger.error(LogComponent.TUNNEL, errorMessage, undefined, { preserveFocus: true });
                this._onTunnelEvent.fire({
                    type: 'error',
                    tunnelId,
                    data: errorMessage
                });
                throw new Error(errorMessage);
            }

            // Check if tunnel is already running
            const existingProcesses = await this.findTunnelProcess(tunnelId);
            if (existingProcesses.length > 0) {
                this.logger.warn(LogComponent.TUNNEL, `Tunnel ${tunnelInfo.name} appears to be already running. Stopping existing processes...`, { preserveFocus: true });
                for (const process of existingProcesses) {
                    await this.killProcess(process.pid, true);
                }
                // Wait a moment for processes to fully stop
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            this.logger.debug(LogComponent.TUNNEL, `Configuring tunnel ${tunnelInfo.name}...`, { preserveFocus: true });

            // Get zones (domains) from Cloudflare
            const zones = await this.apiService.listZones();
            if (!zones.length) {
                throw new Error('No domains found in your Cloudflare account');
            }

            // Let user select a zone
            const selectedZone = await vscode.window.showQuickPick(
                zones.map(zone => ({
                    label: zone.name,
                    description: zone.id,
                    zone: zone
                })),
                {
                    placeHolder: 'Select a domain for your tunnel',
                    title: 'Select Domain'
                }
            );

            if (!selectedZone) {
                throw new Error('Domain selection is required');
            }

            // Get DNS records for selected zone
            const dnsRecords = await this.apiService.listDnsRecords(selectedZone.zone.id);
            
            // Define the type for our quick pick items
            type CnameQuickPickItem = {
                label: string;
                description: string;
                isNew: boolean;
                record?: {
                    id: string;
                    name: string;
                    type: string;
                    content: string;
                };
            };

            // Add option to create new CNAME record
            const quickPickItems: CnameQuickPickItem[] = [
                { label: '$(add) Create new CNAME record', description: '', isNew: true },
                ...dnsRecords
                    .filter(record => record.type === 'CNAME')
                    .map(record => ({
                        label: record.name,
                        description: record.content,
                        isNew: false,
                        record: record
                    }))
            ];

            const selectedRecord = await vscode.window.showQuickPick(
                quickPickItems,
                {
                    placeHolder: 'Select existing CNAME record or create new one',
                    title: 'Configure Hostname'
                }
            );

            if (!selectedRecord) {
                throw new Error('Hostname selection is required');
            }

            let hostname: string;
            if (selectedRecord.isNew) {
                // Get subdomain from user for new CNAME record
                const subdomain = await vscode.window.showInputBox({
                    prompt: `Enter subdomain for ${selectedZone.zone.name}`,
                    placeHolder: 'e.g., myapp',
                    title: 'Create New Subdomain',
                    validateInput: (value) => {
                        if (!value) {
                            return 'Subdomain is required';
                        }
                        if (!/^[a-zA-Z0-9-]+$/.test(value)) {
                            return 'Subdomain can only contain letters, numbers, and hyphens';
                        }
                        return null;
                    }
                });

                if (!subdomain) {
                    throw new Error('Subdomain is required');
                }

                // Check if CNAME record already exists
                const existingRecords = await this.apiService.listDnsRecords(selectedZone.zone.id);
                const existingCname = existingRecords.find(r => 
                    r.type === 'CNAME' && 
                    r.name === `${subdomain}.${selectedZone.zone.name}`
                );

                if (existingCname) {
                    // CNAME already exists - ask user what to do
                    const confirm = await vscode.window.showWarningMessage(
                        `A CNAME record for "${subdomain}.${selectedZone.zone.name}" already exists and points to "${existingCname.content}". Would you like to proceed with using this existing CNAME record?`,
                        { modal: true },
                        'Use Existing', 'Cancel'
                    );

                    if (confirm !== 'Use Existing') {
                        throw new Error('Operation cancelled by user');
                    }

                    hostname = existingCname.name;
                } else {
                    // Create new CNAME record
                    const newRecord = await this.apiService.createCnameRecord(
                        selectedZone.zone.id,
                        subdomain,
                        tunnelId
                    );
                    hostname = `${newRecord.name}.${selectedZone.zone.name}`;
                }
            } else {
                if (!selectedRecord.record) {
                    throw new Error('Selected record is missing required data');
                }

                // Check for CNAME conflicts
                const conflicts = await this.apiService.checkCnameConflicts(
                    selectedZone.zone.id,
                    selectedRecord.label,
                    tunnelId
                );

                if (conflicts.isPointingElsewhere) {
                    // CNAME is pointing elsewhere - ask to update
                    const confirm = await vscode.window.showWarningMessage(
                        `The CNAME record "${selectedRecord.label}" is currently pointing to "${conflicts.existingRecord!.content}". Would you like to update it to point to this tunnel instead?`,
                        { modal: true },
                        'Update', 'Cancel'
                    );

                    if (confirm !== 'Update') {
                        throw new Error('Operation cancelled by user');
                    }

                    // Update the CNAME record
                    await this.apiService.updateCnameRecord(
                        selectedZone.zone.id,
                        conflicts.existingRecord!.id,
                        tunnelId
                    );
                } else if (conflicts.tunnelInUse) {
                    // Another CNAME is using this tunnel - ask to delete
                    const confirm = await vscode.window.showWarningMessage(
                        `This tunnel is currently being used by CNAME record "${conflicts.tunnelInUse.recordName}". Would you like to delete that record and use "${selectedRecord.label}" instead?`,
                        { modal: true },
                        'Delete and Update', 'Cancel'
                    );

                    if (confirm !== 'Delete and Update') {
                        throw new Error('Operation cancelled by user');
                    }

                    // Delete the existing CNAME record
                    await this.apiService.deleteDnsRecord(
                        selectedZone.zone.id,
                        conflicts.tunnelInUse.recordId
                    );

                    // Update the selected CNAME record
                    await this.apiService.updateCnameRecord(
                        selectedZone.zone.id,
                        selectedRecord.record.id,
                        tunnelId
                    );
                } else {
                    // No conflicts - update the selected CNAME record
                    await this.apiService.updateCnameRecord(
                        selectedZone.zone.id,
                        selectedRecord.record.id,
                        tunnelId
                    );
                }

                hostname = selectedRecord.label;
            }

            // Now that we have all the configuration, show the start notification
            vscode.window.showInformationMessage(`Starting tunnel ${tunnelInfo.name} for port ${port} ...`);

            // Log the start of tunnel operation
            this.logger.info(LogComponent.TUNNEL, `Starting tunnel ${tunnelInfo.name} (${tunnelId}) on port ${port} with hostname ${hostname}`, { preserveFocus: true });

            // Build command arguments
            const args = ['tunnel', 'run'];
            args.push('--token', token);
            args.push('--url', `http://localhost:${port}`);

            // Log the full command for debugging (redact token)
            const debugCommand = ['cloudflared', ...args].join(' ').replace(token, '[REDACTED]');
            this.logger.debug(LogComponent.TUNNEL, `Running command: ${debugCommand}`, { preserveFocus: true });

            // Create log files for stdout and stderr
            const logDir = path.join(this.context.extensionPath, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const stdoutLog = path.join(logDir, `tunnel-${tunnelId}-stdout.log`);
            const stderrLog = path.join(logDir, `tunnel-${tunnelId}-stderr.log`);

            // Spawn the process
            const tunnel = cp.spawn('cloudflared', args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    NO_AUTOUPDATE: '1', // Prevent autoupdate during tunnel operation
                },
                detached: true,
                shell: true
            });

            // Detach the process
            tunnel.unref();

            // Store the process ID for cleanup
            const tunnelPid = tunnel.pid;
            if (!tunnelPid) {
                throw new Error('Failed to get process ID for tunnel');
            }

            this.logger.debug(LogComponent.TUNNEL, `Tunnel process started with PID ${tunnelPid}`, { preserveFocus: true });

            // Create write streams for the log files
            const stdoutStream = fs.createWriteStream(stdoutLog, { flags: 'a' });
            const stderrStream = fs.createWriteStream(stderrLog, { flags: 'a' });

            // Store process info for cleanup
            this.runningTunnels.set(tunnelId, {
                process: tunnel,
                pid: tunnelPid,
                logStreams: [stdoutStream, stderrStream]
            });

            // Show started notification immediately after process is confirmed running
            vscode.window.showInformationMessage(`Tunnel ${tunnelInfo.name} started successfully.`);

            // Set up stdout handling
            if (tunnel.stdout) {
                tunnel.stdout.setEncoding('utf8');
                tunnel.stdout.on('data', (data: string) => {
                    const lines = data.split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        
                        // Write to log file
                        stdoutStream.write(line + '\n');

                        // Look for connection status
                        if (line.includes('Registered tunnel connection')) {
                            const connMatch = line.match(/location=(\w+)/);
                            const location = connMatch ? connMatch[1] : 'unknown';
                            
                            // Log successful connection
                            this.logger.info(LogComponent.TUNNEL, `Tunnel ${tunnelInfo.name} connected successfully at ${location}`, { preserveFocus: true });
                            
                            // Show connection notification
                            vscode.window.showInformationMessage(`Connected at ${location}`);
                            
                            this._onTunnelEvent.fire({
                                type: 'status',
                                tunnelId,
                                data: {
                                    status: 'connected',
                                    location: location
                                }
                            });
                            
                            // Refresh tunnel list after successful connection
                            this.refreshTunnelList(tunnelId);
                        }
                    }
                });
            }

            // Handle stderr
            if (tunnel.stderr) {
                tunnel.stderr.setEncoding('utf8');
                tunnel.stderr.on('data', (data: string) => {
                    const lines = data.split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        
                        // Write to log file
                        stderrStream.write(line + '\n');

                        // Only log actual errors
                        if (line.includes('ERR') || line.includes('error') || line.includes('Error')) {
                            this.logger.error(LogComponent.TUNNEL, `Tunnel error: ${line}`, undefined, { preserveFocus: true });
                            this._onTunnelEvent.fire({
                                type: 'error',
                                tunnelId,
                                data: line
                            });
                        }
                    }
                });
            }

            // Handle process exit
            tunnel.on('exit', (code, signal) => {
                const exitMsg = `Tunnel process exited with code ${code} and signal ${signal}`;
                this.logger.debug(LogComponent.TUNNEL, exitMsg, { preserveFocus: true });
                stdoutStream.end();
                stderrStream.end();
                this.runningTunnels.delete(tunnelId);

                if (code !== 0) {
                    this.logger.error(LogComponent.TUNNEL, `Tunnel failed: ${exitMsg}`, undefined, { preserveFocus: true });
                    this._onTunnelEvent.fire({
                        type: 'error',
                        tunnelId,
                        data: `Tunnel process exited with code ${code}`
                    });
                }
            });

            // Handle process errors
            tunnel.on('error', (error) => {
                const errorMsg = `Tunnel process error: ${error.message}`;
                this.logger.error(LogComponent.TUNNEL, errorMsg, error, { preserveFocus: true });
                stdoutStream.end();
                stderrStream.end();
                this._onTunnelEvent.fire({
                    type: 'error',
                    tunnelId,
                    data: errorMsg
                });
            });

            // Set up a timeout to verify the tunnel is running
            const timeout = setTimeout(async () => {
                const isRunning = await this.checkTunnelStatus(tunnelId);
                if (!isRunning) {
                    const timeoutMsg = `Tunnel ${tunnelInfo.name} failed to start within the timeout period`;
                    this.logger.error(LogComponent.TUNNEL, timeoutMsg, undefined, { preserveFocus: true });
                    this._onTunnelEvent.fire({
                        type: 'error',
                        tunnelId,
                        data: timeoutMsg
                    });
                }
            }, 30000); // 30 second timeout

            // Clear timeout if process exits
            tunnel.on('exit', () => clearTimeout(timeout));

            return tunnel;
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to run tunnel:', error);
            throw error;
        }
    }

    /**
     * Helper method to refresh tunnel list
     */
    private async refreshTunnelList(tunnelId: string): Promise<void> {
        try {
            // Initial refresh after 2 seconds
            setTimeout(async () => {
                try {
                    await this.listTunnels();
                    this._onTunnelEvent.fire({
                        type: 'status',
                        tunnelId,
                        data: { status: 'refresh' }
                    });
                } catch (err) {
                    this.logger.error(LogComponent.TUNNEL, 'Failed initial refresh of tunnel list:', err);
                }
            }, 2000);

            // Second refresh after 5 seconds to ensure status is up to date
            setTimeout(async () => {
                try {
                    await this.listTunnels();
                    this._onTunnelEvent.fire({
                        type: 'status',
                        tunnelId,
                        data: { status: 'refresh' }
                    });
                } catch (err) {
                    this.logger.error(LogComponent.TUNNEL, 'Failed second refresh of tunnel list:', err);
                }
            }, 5000);
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.logger.error(LogComponent.TUNNEL, 'Failed to refresh tunnel list', error);
        }
    }

    /**
     * Finds all cloudflared processes
     * @returns Array of PIDs and their command lines
     */
    private async findCloudflaredProcesses(): Promise<Array<{ pid: number; cmdline: string }>> {
        try {
            // Use ps aux to find all cloudflared processes and get their command lines
            const { stdout } = await exec('ps aux | grep cloudflared | grep -v grep');
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
                        await exec(`pkill -TERM -P ${pid}`).catch(() => {});
                        await exec(`pkill -TERM -f "cloudflared.*${pid}"`).catch(() => {});
                        await exec(`pkill -TERM -f "cloudflared.*tunnel.*run"`).catch(() => {});
                    } catch (error) {
                        // If pkill fails, try direct kill
                        try {
                            process.kill(pid, 'SIGTERM');
                        } catch (error) {
                            this.logger.warn(LogComponent.TUNNEL, `Failed to kill process ${pid} with SIGTERM`, { preserveFocus: true });
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
                        const { stdout } = await exec(`ps -p ${pid} | grep -v PID`);
                        if (!stdout.trim()) {
                            return true; // Process is gone
                        }
                        // Process still running, try SIGKILL
                        await exec(`pkill -KILL -P ${pid}`).catch(() => {});
                        await exec(`pkill -KILL -f "cloudflared.*${pid}"`).catch(() => {});
                        await exec(`pkill -KILL -f "cloudflared.*tunnel.*run"`).catch(() => {});
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
                    await exec(`pkill -KILL -P ${pid}`).catch(() => {});
                    await exec(`pkill -KILL -f "cloudflared.*${pid}"`).catch(() => {});
                    await exec(`pkill -KILL -f "cloudflared.*tunnel.*run"`).catch(() => {});
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
            this.logger.warn(LogComponent.TUNNEL, `Failed to kill process ${pid}`, { preserveFocus: true });
            return false;
        }
    }

    /**
     * Stops a tunnel
     */
    async stopTunnel(tunnelId: string): Promise<void> {
        try {
            // Clean and validate tunnel ID
            const cleanTunnelId = String(tunnelId).trim();
            if (!cleanTunnelId) {
                throw new Error('Empty tunnel ID provided');
            }

            // Get tunnel info for the name
            const tunnelInfo = await this.getTunnelInfo(cleanTunnelId);
            if (!tunnelInfo || !tunnelInfo.name) {
                throw new Error('Failed to get tunnel information');
            }

            // Show stopping notification
            vscode.window.showInformationMessage(`Stopping tunnel ${tunnelInfo.name} ...`);

            // Log initial tunnel state
            this.logger.info(
                LogComponent.TUNNEL, 
                `Initial tunnel state for ${tunnelInfo.name} (${cleanTunnelId}) - Connections: ${tunnelInfo.connections?.length || 0}, Status: ${tunnelInfo.status}, Active: ${tunnelInfo.conns_active_at}, Inactive: ${tunnelInfo.conns_inactive_at}`,
                { preserveFocus: true }
            );
            
            let processesKilled = false;
            
            // First try our tracked process
            const tunnelData = this.runningTunnels.get(cleanTunnelId);
            if (tunnelData) {
                this.logger.debug(LogComponent.TUNNEL, `Found tracked tunnel process with PID ${tunnelData.pid}`);
                
                const { process: tunnelProcess, pid, logStreams } = tunnelData;
                processesKilled = await this.killProcess(pid, true);
                this.logger.debug(LogComponent.TUNNEL, `Kill result for tracked process ${pid}: ${processesKilled}`);
                
                // Clean up log streams
                logStreams.forEach(stream => stream.end());
                this.runningTunnels.delete(cleanTunnelId);
            } else {
                this.logger.debug(LogComponent.TUNNEL, 'No tracked tunnel process found');
            }

            // Find all processes that might be running this tunnel
            const processes = await this.findTunnelProcess(cleanTunnelId);
            if (processes.length > 0) {
                this.logger.debug(
                    LogComponent.TUNNEL, 
                    `Found ${processes.length} untracked tunnel processes: ${JSON.stringify(processes.map(p => ({ pid: p.pid, cmd: p.cmdline })))}`,
                    { preserveFocus: true }
                );
                
                // Try to kill all found processes
                for (const process of processes) {
                    this.logger.debug(LogComponent.TUNNEL, `Attempting to kill process ${process.pid}`);
                    const killed = await this.killProcess(process.pid, true);
                    this.logger.debug(LogComponent.TUNNEL, `Kill result for process ${process.pid}: ${killed}`);
                    processesKilled = processesKilled || killed;
                }
            } else {
                this.logger.debug(LogComponent.TUNNEL, 'No untracked tunnel processes found');
            }

            if (!processesKilled) {
                // If no processes were killed, try a more aggressive approach
                this.logger.debug(LogComponent.TUNNEL, 'No processes killed, trying aggressive cleanup');
                const allProcesses = await this.findCloudflaredProcesses();
                this.logger.debug(
                    LogComponent.TUNNEL, 
                    `Found ${allProcesses.length} total cloudflared processes: ${JSON.stringify(allProcesses.map(p => ({ pid: p.pid, cmd: p.cmdline })))}`,
                    { preserveFocus: true }
                );
                
                for (const process of allProcesses) {
                    if (process.cmdline.includes('cloudflared') && process.cmdline.includes('tunnel')) {
                        this.logger.debug(LogComponent.TUNNEL, `Attempting aggressive kill of process ${process.pid}`);
                        const killed = await this.killProcess(process.pid, false);
                        this.logger.debug(LogComponent.TUNNEL, `Aggressive kill result for process ${process.pid}: ${killed}`);
                    }
                }
            }

            // Give Cloudflare API time to register the tunnel stop
            this.logger.debug(LogComponent.TUNNEL, 'Waiting for API to register tunnel stop...');
            await new Promise(resolve => setTimeout(resolve, 4000));

            // Initial refresh after process cleanup
            await this.listTunnels();
            this._onTunnelEvent.fire({
                type: 'status',
                tunnelId: cleanTunnelId,
                data: { status: 'refresh' }
            });

            // Verify tunnel is actually stopped by checking its status
            let retries = 3;
            let verificationDelay = 2000; // Start with 2 seconds
            
            while (retries > 0) {
                const info = await this.getTunnelInfo(cleanTunnelId);
                this.logger.debug(
                    LogComponent.TUNNEL, 
                    `Verification attempt ${4-retries} - Connections: ${info.connections?.length || 0}, Status: ${info.status}, Active: ${info.conns_active_at}, Inactive: ${info.conns_inactive_at}`,
                    { preserveFocus: true }
                );

                if (!info.connections || info.connections.length === 0) {
                    this.logger.debug(LogComponent.TUNNEL, 'Tunnel verified as stopped');
                    // Refresh immediately when we confirm the tunnel is stopped
                    await this.listTunnels();
                    this._onTunnelEvent.fire({
                        type: 'status',
                        tunnelId: cleanTunnelId,
                        data: { status: 'refresh' }
                    });
                    break;
                }
                
                // Check remaining processes
                const remainingProcesses = await this.findTunnelProcess(cleanTunnelId);
                if (remainingProcesses.length > 0) {
                    this.logger.debug(
                        LogComponent.TUNNEL, 
                        `Found ${remainingProcesses.length} remaining processes: ${JSON.stringify(remainingProcesses.map(p => ({ pid: p.pid, cmd: p.cmdline })))}`,
                        { preserveFocus: true }
                    );
                    // Try to kill them again
                    for (const process of remainingProcesses) {
                        await this.killProcess(process.pid, false);
                    }
                }

                this.logger.debug(LogComponent.TUNNEL, `Tunnel still shows connections, waiting ${verificationDelay/1000}s before retry...`);
                await new Promise(resolve => setTimeout(resolve, verificationDelay));
                verificationDelay *= 1.5; // Increase delay exponentially
                retries--;
                
                // Refresh on each verification attempt
                await this.listTunnels();
                this._onTunnelEvent.fire({
                    type: 'status',
                    tunnelId: cleanTunnelId,
                    data: { status: 'refresh' }
                });
                
                if (retries === 0) {
                    this.logger.warn(LogComponent.TUNNEL, 'Tunnel processes killed but API still shows active connections');
                    // Log final tunnel state
                    const finalInfo = await this.getTunnelInfo(cleanTunnelId);
                    this.logger.debug(
                        LogComponent.TUNNEL, 
                        `Final tunnel state - Connections: ${finalInfo.connections?.length || 0}, Status: ${finalInfo.status}, Active: ${finalInfo.conns_active_at}, Inactive: ${finalInfo.conns_inactive_at}`,
                        { preserveFocus: true }
                    );
                }
            }

            this.logger.info(LogComponent.TUNNEL, `Tunnel ${tunnelInfo.name} (${cleanTunnelId}) stopped`);
            
            // Final refresh after everything is done
            await this.listTunnels();
            this._onTunnelEvent.fire({
                type: 'status',
                tunnelId: cleanTunnelId,
                data: { status: 'refresh' }
            });

            // Show the success message after we've confirmed the stop
            vscode.window.showInformationMessage(`Stopped tunnel ${tunnelInfo.name}.`);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to stop tunnel', error);
            throw error;
        }
    }

    /**
     * Checks the status of a tunnel
     * @param tunnelId - The ID of the tunnel to check the status of
     * @returns True if the tunnel is running, false otherwise
     */
    async checkTunnelStatus(tunnelId: string): Promise<boolean> {
        try {
            // Get tunnel info directly from API instead of using CLI
            const info = await this.getTunnelInfo(tunnelId);
            return !!(info.connections && info.connections.length > 0);
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
                const timeoutId: NodeJS.Timeout = setTimeout(() => {
                    this.logger.error(LogComponent.TUNNEL, 'Timeout waiting for quick tunnel URL');
                    tunnel.kill();
                    reject(new Error('Timeout waiting for quick tunnel URL'));
                }, 30000);

                tunnel.stdout?.on('data', (data: Buffer) => {
                    const line = data.toString();
                    output += line;
                    this.logger.debug(LogComponent.TUNNEL, `Quick tunnel stdout: ${line}`);

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
            const processInfo = await this.findTunnelProcess(port);
            if (processInfo.length > 0) {
                this.logger.debug(LogComponent.TUNNEL, `Found quick tunnel process on port ${port} with PIDs ${processInfo.map(p => p.pid).join(', ')}`, { preserveFocus: true });
                for (const process of processInfo) {
                    await this.killProcess(process.pid, true);
                }
                this.logger.info(LogComponent.TUNNEL, `Quick tunnel on port ${port} stopped`, { preserveFocus: true });
                return true;
            }
            return true; // No process found is still success
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to stop quick tunnel:', error);
            return false;
        }
    }
}