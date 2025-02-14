import * as vscode from 'vscode';

/**
 * Centralized message management for the extension
 * All user-facing messages should be defined and managed here
 */
export class Messages {
    // Profile Messages
    static readonly PROFILE_CREATED = (name: string) => `Created profile: ${name}`;
    static readonly PROFILE_DELETED = (name: string) => `Profile "${name}" deleted successfully`;
    static readonly PROFILE_API_KEY_UPDATED = (name: string) => `Updated API key for profile: ${name}`;
    static readonly PROFILE_SWITCHED = (name: string) => `Switched to profile: ${name}`;
    static readonly PROFILE_ACTIVE_UPDATED = 'Active profile updated';
    static readonly NO_PROFILES_FOUND = 'No Cloudflare accounts found for this API key';

    // Tunnel Messages
    static readonly TUNNEL_CREATED = (name: string) => `Created tunnel: ${name}`;
    static readonly TUNNEL_DELETED = (name: string) => `Deleted tunnel: ${name}`;
    static readonly TUNNEL_STARTED = (name: string, hostname: string, port: string | number) => 
        `Started TUNNEL: ${name} with HOSTNAME: ${hostname} for PORT: ${port}`;
    static readonly TUNNEL_STOPPED = (name: string) => `TUNNEL: ${name} stopped.`;
    static readonly TUNNEL_URL_COPIED = 'Tunnel URL copied to clipboard';
    static readonly NO_TUNNEL_URL = 'No tunnel URL available';

    // Quick Tunnel Messages
    static readonly QUICK_TUNNEL_CREATED = (name?: string, port?: string | number) => 
        `Created quick tunnel${name ? ` "${name}"` : ''} on port ${port}`;
    static readonly QUICK_TUNNEL_RUNNING = (url: string) => `Quick tunnel is running at ${url}`;
    static readonly QUICK_TUNNEL_STOPPED = (name?: string, port?: string | number) => 
        `Stopped quick tunnel${name ? ` "${name}"` : ''} on port ${port}`;
    static readonly QUICK_TUNNEL_RATE_LIMIT = 
        'Rate limit exceeded for quick tunnels. Please wait a few minutes before trying again.';
    static readonly QUICK_TUNNEL_PORT_IN_USE = (port: string | number) => 
        `Port ${port} is already in use. Please choose a different port.`;

    // Cloudflared Messages
    static readonly CLOUDFLARED_NOT_FOUND = 'cloudflared is required but not found on your system.';
    static readonly CLOUDFLARED_INSTALL_ACTION = 'Installation Instructions';
    static readonly CLOUDFLARED_INSTALL_DARWIN = 'To install, run: `brew install cloudflare/cloudflare/cloudflared`';
    static readonly CLOUDFLARED_INSTALL_WIN32 = 'Download the installer from: https://github.com/cloudflare/cloudflared/releases';
    static readonly CLOUDFLARED_INSTALL_LINUX = 'Install using your package manager or download from: https://github.com/cloudflare/cloudflared/releases';
    static readonly CLOUDFLARED_INSTALL_DEFAULT = 'Download from: https://github.com/cloudflare/cloudflared/releases';
    static readonly CLOUDFLARED_INSTALL_DOCS = 'https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation';
    static readonly CLOUDFLARED_VERSION_ERROR = 'Failed to verify cloudflared installation';

    // Token Messages
    static readonly TOKEN_COPIED = 'Token copied to clipboard (will be cleared in 30 seconds)';
    static readonly TOKEN_SECURITY_WARNING = 
        'The tunnel token will be copied to your clipboard and automatically cleared after 30 seconds. ' +
        'Make sure to use it before then.';
    static readonly TOKEN_COPY_CANCELLED = 'Token copy cancelled by user';

    // Error Messages
    static readonly ERROR_CREATE_PROFILE = (error: any) => `Failed to create profile: ${error}`;
    static readonly ERROR_UPDATE_API_KEY = (error: any) => `Failed to update API key: ${error}`;
    static readonly ERROR_DELETE_PROFILE = (error: any) => `Failed to delete profile: ${error}`;
    static readonly ERROR_SET_ACTIVE_PROFILE = (error: any) => `Failed to set active profile: ${error}`;
    static readonly ERROR_CREATE_TUNNEL = (error: any) => `Failed to create tunnel: ${error}`;
    static readonly ERROR_DELETE_TUNNEL = (error: any) => `Failed to delete tunnel: ${error}`;
    static readonly ERROR_START_TUNNEL = (error: any) => `Failed to start tunnel: ${error}`;
    static readonly ERROR_STOP_TUNNEL = (error: any) => `Failed to stop tunnel: ${error}`;
    static readonly ERROR_COPY_TOKEN = (error: any) => `Failed to copy token: ${error}`;
    static readonly ERROR_COPY_URL = (error: any) => `Failed to copy tunnel URL: ${error}`;

    // Helper methods for showing messages
    static async showInfo(message: string): Promise<void> {
        await vscode.window.showInformationMessage(message);
    }

    static async showWarning(message: string, ...items: string[]): Promise<string | undefined> {
        return await vscode.window.showWarningMessage(message, ...items);
    }

    static async showError(message: string, details?: string): Promise<void> {
        if (details) {
            await vscode.window.showErrorMessage(message, { detail: details });
        } else {
            await vscode.window.showErrorMessage(message);
        }
    }

    static async showModal(message: string, ...items: string[]): Promise<string | undefined> {
        return await vscode.window.showWarningMessage(message, { modal: true }, ...items);
    }
} 