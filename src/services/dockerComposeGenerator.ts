import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TunnelManager } from './cloudflared';
import { CloudflareApiService } from './cloudflareApi';
import { Logger, LogComponent } from '../utils/logger';

export class DockerComposeGenerator {
    private readonly logger = Logger.getInstance();

    constructor(
        private readonly tunnelManager: TunnelManager,
        private readonly apiService: CloudflareApiService
    ) {}

    /**
     * Generates a Docker Compose file for a specific tunnel
     * @param tunnelId The ID of the tunnel to generate the compose file for
     * @param tunnelName The name of the tunnel
     * @param port The port the tunnel is running on
     * @returns The path to the generated file or URI of the untitled file
     */
    async generateComposeFile(tunnelId: string, tunnelName: string, port: number): Promise<string> {
        try {
            // Get the tunnel token
            const token = await this.apiService.getTunnelToken(tunnelId);
            if (!token) {
                throw new Error('Could not get tunnel token');
            }

            // Create the Docker Compose content
            const composeContent = this.createComposeFileContent(tunnelName, port);
            const envContent = `TUNNEL_TOKEN=${token}\n`;

            // Get the workspace folder
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            
            if (workspaceFolder) {
                // If we have a workspace, create both files there
                const composeFileName = `docker-compose.${tunnelName}.yml`;
                const envFileName = `cloudflare.${tunnelName}.env`;
                const composePath = path.join(workspaceFolder.uri.fsPath, composeFileName);
                const envPath = path.join(workspaceFolder.uri.fsPath, envFileName);
                
                fs.writeFileSync(composePath, composeContent);
                fs.writeFileSync(envPath, envContent);
                return composePath;
            } else {
                // If no workspace, create untitled files
                const composeFile = await vscode.workspace.openTextDocument({
                    content: composeContent,
                    language: 'yaml'
                });
                const envFile = await vscode.workspace.openTextDocument({
                    content: envContent,
                    language: 'dotenv'
                });
                await vscode.window.showTextDocument(composeFile);
                await vscode.window.showTextDocument(envFile, { viewColumn: vscode.ViewColumn.Beside });
                return 'New untitled files';
            }
        } catch (error) {
            this.logger.error(LogComponent.EXTENSION, `Failed to generate Docker Compose file: ${error}`);
            throw error;
        }
    }

    /**
     * Creates the content for the Docker Compose file
     * @param tunnelName The name of the tunnel
     * @param port The port to expose
     * @returns The Docker Compose file content
     */
    private createComposeFileContent(tunnelName: string, port: number): string {
        return `# Cloudflare Tunnel Docker Compose Configuration
# ==========================================
#
# Important:
# ---------
# Before using this file:
# 1. Rename it to 'docker-compose.yml' (or use -f flag with docker compose)
# 2. Ensure the cloudflare.${tunnelName}.env file is in the same directory
# 3. Start the tunnel with: docker compose up -d
#    Stop with: docker compose down
#
# Default Configuration:
# --------------------
# - Uses host.docker.internal to connect to services on your host machine
# - Tunnel token is stored in cloudflare.${tunnelName}.env file
# - Service automatically restarts unless stopped manually
#
# Environment File (cloudflare.${tunnelName}.env):
# --------------------------------------------
# TUNNEL_TOKEN=your-tunnel-token
#
# Connecting to Other Services:
# --------------------------
# 1. For a service in the same Docker Compose:
#    Change the URL to: http://service-name:${port}
#    Example: http://web-app:${port}
#
# 2. For services on your host machine (default):
#    Use: http://host.docker.internal:${port}
#
# Adding Docker Networks:
# --------------------
# To connect this tunnel to other services, add this to the tunnel service:
#
#     networks:
#       - your-network-name
#
#    Then add at the bottom of the file:
#
#     networks:
#       your-network-name:
#         driver: bridge
#

services:
  ${tunnelName}:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate --url http://host.docker.internal:${port} run
    env_file:
      - cloudflare.${tunnelName}.env
    restart: unless-stopped
`;
    }
} 