"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenAuditService = void 0;
const logger_1 = require("../utils/logger");
class TokenAuditService {
    constructor(context) {
        this.context = context;
        this.auditEvents = [];
        this.logger = logger_1.Logger.getInstance();
        this.loadAuditEvents();
    }
    async loadAuditEvents() {
        const events = await this.context.secrets.get(TokenAuditService.AUDIT_LOG_KEY);
        if (events) {
            try {
                this.auditEvents = JSON.parse(events);
            }
            catch (error) {
                this.logger.error(logger_1.LogComponent.TUNNEL, 'Failed to parse audit events:', error instanceof Error ? error.message : String(error));
                this.auditEvents = [];
            }
        }
    }
    async saveAuditEvents() {
        try {
            // Keep only the most recent events
            if (this.auditEvents.length > TokenAuditService.MAX_AUDIT_EVENTS) {
                this.auditEvents = this.auditEvents.slice(-TokenAuditService.MAX_AUDIT_EVENTS);
            }
            await this.context.secrets.store(TokenAuditService.AUDIT_LOG_KEY, JSON.stringify(this.auditEvents));
        }
        catch (error) {
            this.logger.error(logger_1.LogComponent.TUNNEL, 'Failed to save audit events:', error instanceof Error ? error.message : String(error));
        }
    }
    async recordEvent(event) {
        const auditEvent = {
            ...event,
            timestamp: new Date().toISOString()
        };
        this.auditEvents.push(auditEvent);
        await this.saveAuditEvents();
        // Log suspicious activity
        if (!event.success) {
            this.logger.warn(logger_1.LogComponent.TUNNEL, 'Suspicious token activity detected:', JSON.stringify(auditEvent));
        }
    }
    async getAuditEvents(tunnelId) {
        if (tunnelId) {
            return this.auditEvents.filter(event => event.tunnelId === tunnelId);
        }
        return this.auditEvents;
    }
    async getFailedAttempts(timeWindowMs = 3600000) {
        const cutoff = Date.now() - timeWindowMs;
        return this.auditEvents.filter(event => !event.success && new Date(event.timestamp).getTime() > cutoff);
    }
}
exports.TokenAuditService = TokenAuditService;
TokenAuditService.AUDIT_LOG_KEY = 'tunnelfy.token.audit';
TokenAuditService.MAX_AUDIT_EVENTS = 1000;
//# sourceMappingURL=tokenAuditService.js.map