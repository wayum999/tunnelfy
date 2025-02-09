import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogComponent } from '../../utils/logger';

/**
 * TunnelLogger - Manages logging for Cloudflare tunnels
 * 
 * This service is responsible for:
 * 1. Creating and managing tunnel-specific log files
 * 2. Implementing log rotation to prevent excessive disk usage
 * 3. Cleaning up old log files automatically
 * 4. Providing structured logging for tunnel events
 * 
 * Features:
 * - Automatic log rotation when files exceed size limit
 * - Configurable retention period for log files
 * - Separate log file for each tunnel
 * - Structured event logging with timestamps
 */
export class TunnelLogger {
    private readonly logDir: string;
    private readonly maxLogSize = 10 * 1024 * 1024; // 10MB
    private readonly maxLogFiles = 5;

    constructor(
        private baseLogger: Logger,
        private workspaceDir: string
    ) {
        this.logDir = path.join(this.workspaceDir, 'logs', 'tunnels');
        this.ensureLogDirectory();
    }

    /**
     * Creates the log directory if it doesn't exist
     * @private
     */
    private ensureLogDirectory(): void {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * Creates a write stream for tunnel-specific logging
     * @param tunnelId The ID of the tunnel
     * @returns A write stream for the tunnel's log file
     */
    createLogStream(tunnelId: string): fs.WriteStream {
        const logFile = path.join(this.logDir, `${tunnelId}.log`);
        return fs.createWriteStream(logFile, { flags: 'a' });
    }

    /**
     * Logs a tunnel event with optional details
     * @param tunnelId The ID of the tunnel
     * @param event The event description
     * @param details Optional event details
     */
    async logTunnelEvent(tunnelId: string, event: string, details?: any): Promise<void> {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] Tunnel ${tunnelId}: ${event}${details ? ` - ${JSON.stringify(details)}` : ''}`;
        
        this.baseLogger.info(LogComponent.TUNNEL, logMessage);
        await this.checkAndRotateLogs(tunnelId);
    }

    /**
     * Checks if log rotation is needed and performs rotation if necessary
     * @param tunnelId The ID of the tunnel
     * @private
     */
    private async checkAndRotateLogs(tunnelId: string): Promise<void> {
        const logFile = path.join(this.logDir, `${tunnelId}.log`);
        
        try {
            const stats = await fs.promises.stat(logFile);
            if (stats.size > this.maxLogSize) {
                await this.rotateLogs(tunnelId);
            }
        } catch (error) {
            this.baseLogger.error(LogComponent.TUNNEL, `Error checking log size: ${error}`);
        }
    }

    /**
     * Performs log rotation for a tunnel's log files
     * Keeps a maximum number of backup files defined by maxLogFiles
     * @param tunnelId The ID of the tunnel
     * @private
     */
    private async rotateLogs(tunnelId: string): Promise<void> {
        const baseLogFile = path.join(this.logDir, `${tunnelId}.log`);
        
        // Rotate existing log files
        for (let i = this.maxLogFiles - 1; i >= 0; i--) {
            const oldFile = i === 0 ? baseLogFile : path.join(this.logDir, `${tunnelId}.${i}.log`);
            const newFile = path.join(this.logDir, `${tunnelId}.${i + 1}.log`);
            
            try {
                if (fs.existsSync(oldFile)) {
                    if (i === this.maxLogFiles - 1) {
                        await fs.promises.unlink(oldFile);
                    } else {
                        await fs.promises.rename(oldFile, newFile);
                    }
                }
            } catch (error) {
                this.baseLogger.error(LogComponent.TUNNEL, `Error rotating logs: ${error}`);
            }
        }

        // Create new empty log file
        try {
            await fs.promises.writeFile(baseLogFile, '');
        } catch (error) {
            this.baseLogger.error(LogComponent.TUNNEL, `Error creating new log file: ${error}`);
        }
    }

    /**
     * Cleans up log files older than 7 days
     * This helps prevent disk space issues from abandoned or inactive tunnels
     */
    async cleanupOldLogs(): Promise<void> {
        try {
            const files = await fs.promises.readdir(this.logDir);
            const now = Date.now();
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

            for (const file of files) {
                const filePath = path.join(this.logDir, file);
                const stats = await fs.promises.stat(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.promises.unlink(filePath);
                    this.baseLogger.info(LogComponent.TUNNEL, `Deleted old log file: ${file}`);
                }
            }
        } catch (error) {
            this.baseLogger.error(LogComponent.TUNNEL, `Error cleaning up old logs: ${error}`);
        }
    }
} 