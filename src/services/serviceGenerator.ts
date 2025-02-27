import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { TunnelManager } from "./cloudflared";
import { CloudflareApiService } from "./cloudflareApi";
import { Logger, LogComponent } from "../utils/logger";

/**
 * Custom error class for service file generation errors
 */
export class ServiceFileGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ServiceFileGenerationError";
  }
}

/**
 * Represents the result of generating service files
 */
export interface ServiceFileGenerationResult {
  /** The type of generation result */
  type: "workspace" | "untitled";
  /** The type of service generated */
  serviceType: "docker" | "system";
  /** The path to the service file if type is 'workspace', undefined otherwise */
  servicePath?: string;
  /** The path to the env file if type is 'workspace', undefined otherwise */
  envPath?: string;
}

/**
 * Service type options for generation
 */
export type ServiceType = "docker" | "system";

/**
 * Unified service generator for both Docker Compose and System Service files
 */
export class ServiceGenerator {
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly tunnelManager: TunnelManager,
    private readonly apiService: CloudflareApiService,
  ) {}

  /**
   * Generates a service file for a specific tunnel
   * @param tunnelId The ID of the tunnel to generate the service file for
   * @param tunnelName The name of the tunnel
   * @param port The port the tunnel is running on
   * @param serviceType The type of service to generate (docker or system)
   * @returns The result of the service file generation
   * @throws ServiceFileGenerationError if tunnel token cannot be retrieved or if file operations fail
   */
  async generateServiceFile(
    tunnelId: string,
    tunnelName: string,
    port: number,
    serviceType: ServiceType,
  ): Promise<ServiceFileGenerationResult> {
    try {
      // Determine file names and content based on service type
      const isDocker = serviceType === "docker";
      const serviceFileName = isDocker 
        ? `docker-compose.${tunnelName}.yml` 
        : `cloudflared-${tunnelName}.service`;
      const envFileName = isDocker 
        ? `cloudflare.${tunnelName}.env` 
        : `cloudflared-${tunnelName}.env`;
      const serviceLanguage = isDocker ? "yaml" : "systemd";
      
      // Show confirmation dialog
      const generateButton: vscode.MessageItem = { title: "Generate" };
      const cancelButton: vscode.MessageItem = { title: "Cancel" };

      const confirmation = await vscode.window.showInformationMessage(
        `This will generate ${isDocker ? "Docker Compose" : "system service"} files for tunnel "${tunnelName}". The following files will be created:\n` +
          `- ${serviceFileName}\n` +
          `- ${envFileName} (contains sensitive token)`,
        { modal: true },
        generateButton,
        cancelButton,
      );

      if (confirmation?.title !== "Generate") {
        throw new ServiceFileGenerationError(
          "User cancelled service file generation"
        );
      }

      // Get the tunnel token
      const token = await this.apiService.getTunnelToken(tunnelId);
      if (!token) {
        throw new ServiceFileGenerationError("Could not get tunnel token");
      }

      // Create the service file content
      const serviceContent = isDocker 
        ? this.createDockerComposeContent(tunnelName, port)
        : this.createSystemServiceContent(tunnelName, port);
      const envContent = `TUNNEL_TOKEN=${token}\n`;

      // Get the workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

      if (workspaceFolder && workspaceFolder.uri.scheme === "file") {
        // Validate workspace folder exists and is writable
        try {
          await vscode.workspace.fs.stat(workspaceFolder.uri);
        } catch (error) {
          this.logger.error(
            LogComponent.EXTENSION,
            `Invalid workspace folder: ${error}`,
          );
          throw new ServiceFileGenerationError(
            "Invalid workspace folder",
            error,
          );
        }

        // If we have a workspace, create both files there
        const servicePath = path.join(
          workspaceFolder.uri.fsPath,
          serviceFileName,
        );
        const envPath = path.join(workspaceFolder.uri.fsPath, envFileName);

        // Check if files already exist
        if (fs.existsSync(servicePath) || fs.existsSync(envPath)) {
          const overwriteButton: vscode.MessageItem = { title: "Overwrite" };
          const cancelOverwriteButton: vscode.MessageItem = { title: "Cancel" };

          const overwrite = await vscode.window.showWarningMessage(
            "One or both files already exist. Do you want to overwrite them?",
            { modal: true },
            overwriteButton,
            cancelOverwriteButton,
          );
          if (overwrite?.title !== "Overwrite") {
            throw new ServiceFileGenerationError(
              "User cancelled overwriting existing files",
            );
          }
        }

        // Use try-catch for file operations
        try {
          fs.writeFileSync(servicePath, serviceContent);
          fs.writeFileSync(envPath, envContent);
        } catch (error) {
          this.logger.error(
            LogComponent.EXTENSION,
            `Failed to write service files: ${error}`,
          );
          throw new ServiceFileGenerationError(
            "Failed to write service files",
            error,
          );
        }

        // Open both files in the editor
        const serviceUri = vscode.Uri.file(servicePath);
        const envUri = vscode.Uri.file(envPath);

        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(serviceUri),
        );
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(envUri),
          { viewColumn: vscode.ViewColumn.Beside },
        );

        return {
          type: "workspace",
          serviceType,
          servicePath,
          envPath,
        };
      } else {
        // If no workspace, create untitled files
        const serviceFile = await vscode.workspace.openTextDocument({
          content: serviceContent,
          language: serviceLanguage,
        });
        const envFile = await vscode.workspace.openTextDocument({
          content: envContent,
          language: "dotenv",
        });
        await vscode.window.showTextDocument(serviceFile);
        await vscode.window.showTextDocument(envFile, {
          viewColumn: vscode.ViewColumn.Beside,
        });

        return {
          type: "untitled",
          serviceType,
        };
      }
    } catch (error) {
      this.logger.error(
        LogComponent.EXTENSION,
        `Failed to generate service file: ${error}`,
      );
      if (error instanceof ServiceFileGenerationError) {
        throw error;
      }
      throw new ServiceFileGenerationError(
        `Failed to generate ${serviceType} service file`,
        error,
      );
    }
  }

  /**
   * Creates the content for the Docker Compose file
   * @param tunnelName The name of the tunnel
   * @param port The port to expose
   * @returns The Docker Compose file content
   */
  private createDockerComposeContent(tunnelName: string, port: number): string {
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

  /**
   * Creates the content for the system service file
   * @param tunnelName The name of the tunnel
   * @param port The port to expose
   * @returns The system service file content
   */
  private createSystemServiceContent(tunnelName: string, port: number): string {
    return `# Cloudflare Tunnel System Service Configuration
# ==========================================
#
# Important:
# ---------
# Before using this file:
# 1. Copy this file to /etc/systemd/system/cloudflared-${tunnelName}.service
# 2. Copy the environment file to /etc/cloudflared/cloudflared-${tunnelName}.env
# 3. Start the service:
#    sudo systemctl daemon-reload
#    sudo systemctl enable cloudflared-${tunnelName}
#    sudo systemctl start cloudflared-${tunnelName}
#
# To stop the service:
#    sudo systemctl stop cloudflared-${tunnelName}
#
# To view logs:
#    sudo journalctl -u cloudflared-${tunnelName}
#
# Default Configuration:
# --------------------
# - Service runs as cloudflared user
# - Automatically restarts on failure
# - Loads environment variables from /etc/cloudflared/cloudflared-${tunnelName}.env
#
# Security Notes:
# -------------
# 1. The environment file contains sensitive data (tunnel token)
# 2. Ensure proper file permissions:
#    sudo chown root:root /etc/systemd/system/cloudflared-${tunnelName}.service
#    sudo chmod 644 /etc/systemd/system/cloudflared-${tunnelName}.service
#    sudo chown cloudflared:cloudflared /etc/cloudflared/cloudflared-${tunnelName}.env
#    sudo chmod 600 /etc/cloudflared/cloudflared-${tunnelName}.env

[Unit]
Description=Cloudflare Tunnel - ${tunnelName}
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=cloudflared
Group=cloudflared
Restart=always
RestartSec=1
EnvironmentFile=/etc/cloudflared/cloudflared-${tunnelName}.env
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:${port} run

# Hardening options
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
`;
  }
} 