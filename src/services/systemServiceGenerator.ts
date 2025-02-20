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
interface ServiceFileGenerationResult {
  /** The type of generation result */
  type: "workspace" | "untitled";
  /** The path to the service file if type is 'workspace', undefined otherwise */
  servicePath?: string;
  /** The path to the env file if type is 'workspace', undefined otherwise */
  envPath?: string;
}

export class SystemServiceGenerator {
  private readonly logger: Logger = Logger.getInstance();

  constructor(
    private readonly tunnelManager: TunnelManager,
    private readonly apiService: CloudflareApiService,
  ) {}

  /**
   * Generates a system service file for a specific tunnel
   * @param tunnelId The ID of the tunnel to generate the service file for
   * @param tunnelName The name of the tunnel
   * @param port The port the tunnel is running on
   * @returns The result of the service file generation
   * @throws ServiceFileGenerationError if tunnel token cannot be retrieved or if file operations fail
   */
  async generateServiceFile(
    tunnelId: string,
    tunnelName: string,
    port: number,
  ): Promise<ServiceFileGenerationResult> {
    try {
      // Show confirmation dialog
      const generateButton: vscode.MessageItem = { title: "Generate" };
      const cancelButton: vscode.MessageItem = { title: "Cancel" };

      const confirmation = await vscode.window.showInformationMessage(
        `This will generate system service files for tunnel "${tunnelName}". The following files will be created:\n` +
          `- cloudflared-${tunnelName}.service\n` +
          `- cloudflared-${tunnelName}.env (contains sensitive token)`,
        { modal: true },
        generateButton,
        cancelButton,
      );

      if (confirmation?.title !== "Generate") {
        throw new ServiceFileGenerationError(
          "User cancelled service file generation",
        );
      }

      // Get the tunnel token
      const token = await this.apiService.getTunnelToken(tunnelId);
      if (!token) {
        throw new ServiceFileGenerationError("Could not get tunnel token");
      }

      // Create the service file content
      const serviceContent = this.createServiceFileContent(tunnelName, port);
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
        const serviceFileName = `cloudflared-${tunnelName}.service`;
        const envFileName = `cloudflared-${tunnelName}.env`;
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
          servicePath,
          envPath,
        };
      } else {
        // If no workspace, create untitled files
        const serviceFile = await vscode.workspace.openTextDocument({
          content: serviceContent,
          language: "systemd",
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
        };
      }
    } catch (error) {
      this.logger.error(
        LogComponent.EXTENSION,
        `Failed to generate system service file: ${error}`,
      );
      if (error instanceof ServiceFileGenerationError) {
        throw error;
      }
      throw new ServiceFileGenerationError(
        "Failed to generate system service file",
        error,
      );
    }
  }

  /**
   * Creates the content for the system service file
   * @param tunnelName The name of the tunnel
   * @param port The port to expose
   * @returns The system service file content
   */
  private createServiceFileContent(tunnelName: string, port: number): string {
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
