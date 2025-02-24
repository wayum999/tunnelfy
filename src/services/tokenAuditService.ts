import * as vscode from "vscode";
import { Logger, LogComponent } from "../utils/logger";

export interface TokenAuditEvent {
  timestamp: string;
  action: "create" | "access" | "delete" | "copy";
  tunnelId: string;
  success: boolean;
  error?: string;
}

/**
 * TokenAuditService - Manages audit logging for token-related operations
 *
 * This service is responsible for:
 * 1. Recording all token-related events (creation, access, deletion, copying)
 * 2. Maintaining a secure audit trail in VS Code's secret storage
 * 3. Monitoring for suspicious activity and failed attempts
 * 4. Implementing rate limiting based on failed attempts
 *
 * The audit log is stored securely and includes:
 * - Timestamp of each event
 * - Type of action performed
 * - Success/failure status
 * - Error details if applicable
 * - Associated tunnel ID
 */
export class TokenAuditService {
  private static readonly AUDIT_LOG_KEY = "tunnelfy.token.audit";
  private readonly logger: Logger;
  private auditEvents: TokenAuditEvent[] = [];
  private static readonly MAX_AUDIT_EVENTS = 1000;

  constructor(private context: vscode.ExtensionContext) {
    this.logger = Logger.getInstance();
    this.loadAuditEvents();
  }

  private async loadAuditEvents() {
    const events = await this.context.secrets.get(
      TokenAuditService.AUDIT_LOG_KEY,
    );
    if (events) {
      try {
        this.auditEvents = JSON.parse(events);
      } catch (error) {
        this.logger.error(
          LogComponent.TUNNEL,
          "Failed to parse audit events:",
          error instanceof Error ? error.message : String(error),
        );
        this.auditEvents = [];
      }
    }
  }

  private async saveAuditEvents() {
    try {
      // Keep only the most recent events
      if (this.auditEvents.length > TokenAuditService.MAX_AUDIT_EVENTS) {
        this.auditEvents = this.auditEvents.slice(
          -TokenAuditService.MAX_AUDIT_EVENTS,
        );
      }
      await this.context.secrets.store(
        TokenAuditService.AUDIT_LOG_KEY,
        JSON.stringify(this.auditEvents),
      );
    } catch (error) {
      this.logger.error(
        LogComponent.TUNNEL,
        "Failed to save audit events:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Records a token-related event in the audit log
   * @param event The event details to record
   */
  async recordEvent(event: Omit<TokenAuditEvent, "timestamp">) {
    const auditEvent: TokenAuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.auditEvents.push(auditEvent);
    await this.saveAuditEvents();

    // Log suspicious activity
    if (!event.success) {
      this.logger.warn(
        LogComponent.TUNNEL,
        `Suspicious token activity detected: ${JSON.stringify(auditEvent, null, 2)}`,
        { preserveFocus: true },
      );
    }
  }

  /**
   * Retrieves audit events, optionally filtered by tunnel ID
   * @param tunnelId Optional tunnel ID to filter events
   * @returns Array of matching audit events
   */
  async getAuditEvents(tunnelId?: string): Promise<TokenAuditEvent[]> {
    if (tunnelId) {
      return this.auditEvents.filter((event) => event.tunnelId === tunnelId);
    }
    return this.auditEvents;
  }

  /**
   * Gets failed access attempts within a specified time window
   * @param timeWindowMs Time window in milliseconds (default: 1 hour)
   * @returns Array of failed audit events within the time window
   */
  async getFailedAttempts(
    timeWindowMs: number = 3600000,
  ): Promise<TokenAuditEvent[]> {
    const cutoff = Date.now() - timeWindowMs;
    return this.auditEvents.filter(
      (event) => !event.success && new Date(event.timestamp).getTime() > cutoff,
    );
  }
}
