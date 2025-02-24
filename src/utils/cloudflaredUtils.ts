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
    try {
        const execAsync = promisify(cp.exec);
        const { stdout } = await execAsync('cloudflared --version');
        logger.debug(LogComponent.EXTENSION, `Cloudflared version: ${stdout.trim()}`);
        
        // Update status bar if it exists
        if (cloudflaredStatusBarItem) {
            cloudflaredStatusBarItem.text = `$(cloud)`;
            cloudflaredStatusBarItem.tooltip = `Cloudflared ${stdout.trim()} is installed`;
        }
        
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
            Messages.CLOUDFLARED_INSTALL_ACTION
        );

        if (response === Messages.CLOUDFLARED_INSTALL_ACTION) {
            await vscode.env.openExternal(vscode.Uri.parse(CLOUDFLARED_INSTALL_URL));
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