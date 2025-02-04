import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export interface TokenAuditEvent {
    timestamp: string;
    action: 'create' | 'access' | 'delete' | 'copy';
    tunnelId: string;
    success: boolean;
    error?: string;
}

export class TokenAuditService {
    private static readonly AUDIT_LOG_KEY = 'tunnelfy.token.audit';
    private readonly logger: Logger;
    private auditEvents: TokenAuditEvent[] = [];
    private static readonly MAX_AUDIT_EVENTS = 1000;

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        this.loadAuditEvents();
    }

    private async loadAuditEvents() {
        const events = await this.context.secrets.get(TokenAuditService.AUDIT_LOG_KEY);
        if (events) {
            try {
                this.auditEvents = JSON.parse(events);
            } catch (error) {
                this.logger.error('Failed to parse audit events:', error);
                this.auditEvents = [];
            }
        }
    }

    private async saveAuditEvents() {
        try {
            // Keep only the most recent events
            if (this.auditEvents.length > TokenAuditService.MAX_AUDIT_EVENTS) {
                this.auditEvents = this.auditEvents.slice(-TokenAuditService.MAX_AUDIT_EVENTS);
            }
            await this.context.secrets.store(
                TokenAuditService.AUDIT_LOG_KEY,
                JSON.stringify(this.auditEvents)
            );
        } catch (error) {
            this.logger.error('Failed to save audit events:', error);
        }
    }

    async recordEvent(event: Omit<TokenAuditEvent, 'timestamp'>) {
        const auditEvent: TokenAuditEvent = {
            ...event,
            timestamp: new Date().toISOString()
        };
        
        this.auditEvents.push(auditEvent);
        await this.saveAuditEvents();
        
        // Log suspicious activity
        if (!event.success) {
            this.logger.warn(
                'Suspicious token activity detected:',
                JSON.stringify(auditEvent)
            );
        }
    }

    async getAuditEvents(tunnelId?: string): Promise<TokenAuditEvent[]> {
        if (tunnelId) {
            return this.auditEvents.filter(event => event.tunnelId === tunnelId);
        }
        return this.auditEvents;
    }

    async getFailedAttempts(timeWindowMs: number = 3600000): Promise<TokenAuditEvent[]> {
        const cutoff = Date.now() - timeWindowMs;
        return this.auditEvents.filter(
            event => !event.success && new Date(event.timestamp).getTime() > cutoff
        );
    }
}
