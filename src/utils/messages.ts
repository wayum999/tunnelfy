import * as vscode from "vscode";
import * as path from "path";

/**
 * Centralized message management for the extension
 * All user-facing messages should be defined and managed here
 */
export class Messages {
  // Profile Messages
  static readonly PROFILE_CREATED = (name: string) =>
    `Profile "${name}" created successfully`;
  static readonly PROFILE_DELETED = (name: string) =>
    `Profile "${name}" deleted successfully`;
  static readonly PROFILE_API_KEY_UPDATED = (name: string) =>
    `API key updated for profile "${name}"`;
  static readonly PROFILE_SWITCHED = (name: string) =>
    `Switched to profile "${name}"`;
  static readonly PROFILE_ACTIVE_UPDATED =
    "Active profile updated successfully";
  static readonly NO_PROFILES_FOUND =
    "No Cloudflare accounts found for this API key";

  // Tunnel Messages
  static readonly TUNNEL_CREATED = (name: string) =>
    `Tunnel "${name}" has been created.`;
  static readonly TUNNEL_DELETED = (name: string) =>
    `Tunnel "${name}" has been deleted.`;
  static readonly TUNNEL_STARTED = (
    name: string,
    hostname: string,
    targetUrlOrPort: string | number,
  ) => {
    // If targetUrlOrPort is a number, it's a port (backward compatibility)
    if (typeof targetUrlOrPort === 'number') {
      return `Tunnel "${name}" is now running at ${hostname} (port ${targetUrlOrPort}).`;
    }
    // Otherwise it's a URL
    return `Tunnel "${name}" is now running at ${hostname} (target: ${targetUrlOrPort}).`;
  };
  static readonly TUNNEL_STOPPED = (name: string) =>
    `Tunnel "${name}" has been stopped.`;
  static readonly TUNNEL_NOT_OWNED = (name: string) =>
    `Tunnelfy did not start tunnel "${name}", so it cannot stop it. Stop it where it was started.`;
  static readonly TUNNEL_STOP_FAILED = (name: string, reason?: string) => ({
    message: `Failed to stop tunnel "${name}"`,
    detail: Messages.describeStopFailure(reason),
  });
  static readonly NO_OWNED_TUNNELS = "No running tunnels started by Tunnelfy to stop.";
  static readonly TUNNEL_URL_COPIED = "Tunnel URL copied to clipboard";
  static readonly NO_TUNNEL_URL = "No tunnel URL available";
  static readonly TUNNELS_REFRESHED = "Tunnel list has been refreshed.";
  static readonly ERROR_REFRESH_TUNNELS = (error: unknown) =>
    `Failed to refresh tunnel list: ${error instanceof Error ? error.message : String(error)}`;

  // Quick Tunnel Messages
  static readonly QUICK_TUNNEL_STARTING = (
    name?: string,
    portOrUrl?: string | number,
  ) => {
    if (typeof portOrUrl === 'number') {
      return `Starting quick tunnel${name ? ` "${name}"` : ""} on port ${portOrUrl}...`;
    }
    return `Starting quick tunnel${name ? ` "${name}"` : ""} for ${portOrUrl}...`;
  };
  static readonly QUICK_TUNNEL_CREATED = (
    name?: string,
    portOrUrl?: string | number,
  ) => {
    if (typeof portOrUrl === 'number') {
      return `Quick tunnel${name ? ` "${name}"` : ""} created successfully on port ${portOrUrl}`;
    }
    return `Quick tunnel${name ? ` "${name}"` : ""} created successfully for ${portOrUrl}`;
  };
  static readonly QUICK_TUNNEL_RUNNING = (url: string, name?: string) =>
    `Quick tunnel${name ? ` "${name}"` : ""} is running at ${url}`;
  static readonly QUICK_TUNNEL_STOPPED = (
    name?: string,
    port?: string | number,
  ) =>
    `Quick tunnel${name ? ` "${name}"` : ""} on port ${port} stopped successfully`;
  static readonly QUICK_TUNNEL_NOT_OWNED = (port?: string | number) =>
    `Tunnelfy is not running a quick tunnel on port ${port}, so there is nothing to stop.`;
  static readonly QUICK_TUNNEL_RATE_LIMIT = {
    message: "Rate limit exceeded for quick tunnels",
    detail:
      "Please wait a few minutes before trying again. Cloudflare limits the number of quick tunnels you can create in a short time period.",
  };
  static readonly QUICK_TUNNEL_PORT_IN_USE = (port: string | number) => ({
    message: `Port ${port} is already in use`,
    detail:
      "Another application or tunnel might be using this port. Please choose a different port.",
  });
  static readonly QUICK_TUNNEL_CONNECTION_ERROR = {
    message: "Failed to connect to Cloudflare",
    detail: "Please check your internet connection and try again.",
  };

  // Cloudflared Messages
  static readonly CLOUDFLARED_NOT_FOUND = {
    message: "cloudflared is required but not found on your system",
    detail: "Please install cloudflared to use tunnel features",
  };
  static readonly CLOUDFLARED_INSTALL_ACTION = "Installation Instructions";
  static readonly CLOUDFLARED_DISMISS_ACTION = "Do not remind me";
  static readonly CLOUDFLARED_INSTALL_DARWIN =
    "To install with homebrew, run: `brew install cloudflared`";
  static readonly CLOUDFLARED_INSTALL_WIN32 =
    "Download the installer from: https://github.com/cloudflare/cloudflared/releases";
  static readonly CLOUDFLARED_INSTALL_LINUX =
    "Install using your package manager or download from: https://github.com/cloudflare/cloudflared/releases";
  static readonly CLOUDFLARED_INSTALL_DEFAULT =
    "Download from: https://github.com/cloudflare/cloudflared/releases";
  static readonly CLOUDFLARED_INSTALL_DOCS =
    "https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation";
  static readonly CLOUDFLARED_VERSION_ERROR =
    "Failed to verify cloudflared installation";

  // Input Messages
  static readonly ADDRESS_INPUT_PROMPT = 
    "Enter EITHER the full address to tunnel OR just the port number if using localhost (e.g., http://localhost:8080 -or- 8080 -or- http://127.0.0.1:3000).";
  static readonly ADDRESS_INPUT_VALIDATION_ERROR = 
    "Please enter a valid URL (e.g., http://localhost:8080) or a valid port number (65535)";

  // Token Messages
  static readonly TOKEN_COPIED =
    "Token copied to clipboard (will be cleared in 30 seconds)";
  static readonly TOKEN_SECURITY_WARNING =
    "The tunnel token will be copied to your clipboard and automatically cleared after 30 seconds. " +
    "Make sure to use it before then.";
  static readonly TOKEN_COPY_CANCELLED = "Token copy cancelled by user";

  // Error Messages
  static readonly ERROR_CREATE_PROFILE = (error: any) => ({
    message: "Failed to create profile",
    detail: String(error),
  });
  static readonly ERROR_UPDATE_API_KEY = (error: any) => ({
    message: "Failed to update API key",
    detail: String(error),
  });
  static readonly ERROR_DELETE_PROFILE = (error: any) => ({
    message: "Failed to delete profile",
    detail: String(error),
  });
  static readonly ERROR_SET_ACTIVE_PROFILE = (error: any) => ({
    message: "Failed to set active profile",
    detail: String(error),
  });
  static readonly ERROR_CREATE_TUNNEL = (error: any) => ({
    message: "Failed to create tunnel",
    detail: String(error),
  });
  static readonly ERROR_DELETE_TUNNEL = (error: any) => ({
    message: "Failed to delete tunnel",
    detail: String(error),
  });
  static readonly ERROR_START_TUNNEL = (error: any) => ({
    message: "Failed to start tunnel",
    detail: String(error),
  });
  static readonly ERROR_STOP_TUNNEL = (error: any) => ({
    message: "Failed to stop tunnel",
    detail: String(error),
  });
  static readonly ERROR_COPY_TOKEN = (error: any) => ({
    message: "Failed to copy token",
    detail: String(error),
  });
  static readonly ERROR_COPY_URL = (error: any) => ({
    message: "Failed to copy tunnel URL",
    detail: String(error),
  });
  static readonly ERROR_GENERATE_DOCKER_COMPOSE = (error: any) => ({
    message: "Failed to generate Docker Compose file",
    detail: String(error),
  });
  static readonly ERROR_GENERATE_SYSTEM_SERVICE = (error: any) => ({
    message: "Failed to generate system service file",
    detail: String(error),
  });
  static readonly ERROR_GENERATE_SERVICE = (error: any) => ({
    message: "Failed to generate service file",
    detail: String(error),
  });
  static readonly ERROR_GENERIC = (error: any) => ({
    message: "An error occurred",
    detail: String(error),
  });

  static readonly DOCKER_COMPOSE_GENERATED = (filePath: string) =>
    filePath === "New untitled files"
      ? "Docker Compose and environment files generated in new editors"
      : `Docker Compose and environment files generated at ${path.dirname(filePath)}`;

  static readonly SYSTEM_SERVICE_GENERATED = (result: {
    type: "workspace" | "untitled";
    servicePath?: string;
    envPath?: string;
  }) =>
    result.type === "untitled"
      ? "System service files have been created as untitled files in the editor."
      : `System service files have been created at:\n- ${result.servicePath}\n- ${result.envPath}`;

  static readonly SERVICE_GENERATED = (result: {
    type: "workspace" | "untitled";
    serviceType: "docker" | "system";
    servicePath?: string;
    envPath?: string;
  }) => {
    const serviceTypeLabel = result.serviceType === "docker" ? "Docker Compose" : "System service";
    return result.type === "untitled"
      ? `${serviceTypeLabel} files have been created as untitled files in the editor.`
      : `${serviceTypeLabel} files have been created at:\n- ${result.servicePath}\n- ${result.envPath}`;
  };

  // Helper methods for showing messages
  static async showInfo(message: string): Promise<void> {
    await vscode.window.showInformationMessage(message);
  }

  static async showWarning(
    message: string,
    ...items: string[]
  ): Promise<string | undefined> {
    return await vscode.window.showWarningMessage(message, ...items);
  }

  static async showError(
    messageObj: { message: string; detail?: string } | string,
    ...items: string[]
  ): Promise<string | undefined> {
    if (typeof messageObj === "string") {
      return await vscode.window.showErrorMessage(messageObj, ...items);
    }
    return await vscode.window.showErrorMessage(
      messageObj.message,
      { detail: messageObj.detail },
      ...items,
    );
  }

  static async showModal(
    messageObj: { message: string; detail?: string } | string,
    ...items: string[]
  ): Promise<string | undefined> {
    if (typeof messageObj === "string") {
      return await vscode.window.showWarningMessage(
        messageObj,
        { modal: true },
        ...items,
      );
    }
    return await vscode.window.showWarningMessage(
      messageObj.message,
      { modal: true, detail: messageObj.detail },
      ...items,
    );
  }

  /** Explains a StopResult failure reason in user terms */
  static describeStopFailure(reason?: string): string {
    switch (reason) {
      case "identity-mismatch":
        return "The recorded process is no longer the tunnel Tunnelfy started, so it was not signalled.";
      case "identity-unverified":
        return "Tunnelfy could not confirm that the recorded process is still its tunnel, so it was not signalled.";
      case "still-running-after-kill":
        return "The tunnel process is still running after it was told to stop.";
      case "timeout":
        return "The tunnel did not stop in time.";
      default:
        return reason ? `Reason: ${reason}` : "Unknown reason.";
    }
  }

  // Helper to extract message string from message object or string
  private static getMessageString(
    messageObj: { message: string; detail?: string } | string,
  ): string {
    return typeof messageObj === "string" ? messageObj : messageObj.message;
  }
}
