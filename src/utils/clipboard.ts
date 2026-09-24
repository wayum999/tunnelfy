import * as vscode from "vscode";
import { Logger, LogComponent } from "./logger";
import { Messages } from "./messages";
import { TokenAuditService } from "../services/tokenAuditService";

/** How long a copied token stays on the clipboard before it is cleared. */
export const CLIPBOARD_TIMEOUT_MS = 30000;

/**
 * Copies a tunnel token to the clipboard after a security warning, and clears
 * it again after CLIPBOARD_TIMEOUT_MS if the clipboard still holds it.
 *
 * @returns a disposable that cancels the pending clear
 * @throws Error if the user cancels the warning
 */
export async function copyTokenToClipboard(
  token: string,
  auditService: TokenAuditService,
): Promise<vscode.Disposable> {
  const logger = Logger.getInstance();
  try {
    const response = await Messages.showWarning(
      Messages.TOKEN_SECURITY_WARNING,
      "Continue",
      "Cancel",
    );
    if (response !== "Continue") {
      throw new Error(Messages.TOKEN_COPY_CANCELLED);
    }

    await vscode.env.clipboard.writeText(token);
    await auditService.recordEvent({
      action: "copy",
      tunnelId: "unknown",
      success: true,
    });

    const timeout = setTimeout(async () => {
      const currentClipboard = await vscode.env.clipboard.readText();
      if (currentClipboard === token) {
        await vscode.env.clipboard.writeText("");
        logger.debug(LogComponent.TOKEN, "Cleared token from clipboard");
      }
    }, CLIPBOARD_TIMEOUT_MS);

    return new vscode.Disposable(() => {
      clearTimeout(timeout);
    });
  } catch (error: any) {
    await auditService.recordEvent({
      action: "copy",
      tunnelId: "unknown",
      success: false,
      error: error?.message || "Unknown error occurred",
    });
    throw error;
  }
}
