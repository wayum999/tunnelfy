import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';
import { Logger, LogComponent } from './logger';
import { Messages } from './messages';

let cloudflaredStatusBarItem: vscode.StatusBarItem | undefined;

export function setCloudflaredStatusBarItem(statusBarItem: vscode.StatusBarItem) {
    cloudflaredStatusBarItem = statusBarItem;
}

/**
 * Checks if cloudflared is installed and prompts for installation if not
 * @returns true if cloudflared is installed, false otherwise
 */
export async function checkAndPromptCloudflared(logger: Logger): Promise<boolean> {
    const execAsync = promisify(cp.exec);
    
    // On Linux, check common installation paths if the direct command fails
    const checkPaths = process.platform === 'linux' ? [
        'cloudflared',
        '/usr/local/bin/cloudflared',
        '/usr/bin/cloudflared',
        '/opt/cloudflared/bin/cloudflared',
        `${process.env.HOME}/.local/bin/cloudflared`,
        '/snap/bin/cloudflared'
    ] : ['cloudflared'];
    
    for (const cloudflaredPath of checkPaths) {
        try {
            const { stdout } = await execAsync(`${cloudflaredPath} --version`);
            logger.debug(LogComponent.EXTENSION, `Cloudflared found at ${cloudflaredPath}: ${stdout.trim()}`);
            
            // Update status bar if it exists
            if (cloudflaredStatusBarItem) {
                cloudflaredStatusBarItem.text = `$(cloud)`;
                cloudflaredStatusBarItem.tooltip = `Cloudflared ${stdout.trim()} is installed${cloudflaredPath !== 'cloudflared' ? ` at ${cloudflaredPath}` : ''}`;
            }
            
            return true;
        } catch (error) {
            // Continue to next path
            continue;
        }
    }
    
    // If we get here, cloudflared was not found in any location
    try {
        // This will always fail, but keeps the original error handling logic
        await execAsync('cloudflared --version');
        return true;
    } catch (error: unknown) {
        const platform = process.platform;
        let installInstructions = '';
        
        switch (platform) {
            case 'darwin':
                installInstructions = Messages.CLOUDFLARED_INSTALL_DARWIN;
                break;
            case 'win32':
                installInstructions = Messages.CLOUDFLARED_INSTALL_WIN32;
                break;
            case 'linux':
                installInstructions = Messages.CLOUDFLARED_INSTALL_LINUX;
                break;
            default:
                installInstructions = Messages.CLOUDFLARED_INSTALL_DEFAULT;
        }

        // Update status bar if it exists
        if (cloudflaredStatusBarItem) {
            cloudflaredStatusBarItem.text = `$(notebook-state-error)`;
            cloudflaredStatusBarItem.tooltip = `Cloudflared is not installed\nClick to view installation instructions\n${installInstructions}`;
            cloudflaredStatusBarItem.command = 'tunnelfy.showCloudflaredInstallInstructions';
        }

        const CLOUDFLARED_INSTALL_URL = Messages.CLOUDFLARED_INSTALL_DOCS;
        
        const response = await vscode.window.showErrorMessage(
            Messages.CLOUDFLARED_NOT_FOUND.message,
            { 
                modal: true, 
                detail: installInstructions
            },
            Messages.CLOUDFLARED_INSTALL_ACTION,
            Messages.CLOUDFLARED_DISMISS_ACTION
        );

        if (response === Messages.CLOUDFLARED_INSTALL_ACTION) {
            await vscode.env.openExternal(vscode.Uri.parse(CLOUDFLARED_INSTALL_URL));
        } else if (response === Messages.CLOUDFLARED_DISMISS_ACTION) {
            // Disable cloudflared checking
            const config = vscode.workspace.getConfiguration('tunnelfy');
            await config.update('checkCloudflared', false, vscode.ConfigurationTarget.Global);
            logger.info(LogComponent.EXTENSION, 'Cloudflared checking disabled by user');
            
            // Show secondary dialog with information about re-enabling
            await vscode.window.showInformationMessage(
                "Note: You can re-enable the cloudflared check in the Tunnelfy extension settings (tunnelfy.checkCloudflared) if you change your mind."
            );
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(
            LogComponent.EXTENSION, 
            `Cloudflared not found: ${errorMessage}`, 
            { preserveFocus: true }
        );
        
        return false;
    }
} 