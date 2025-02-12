import * as fs from 'fs';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { Logger, LogComponent } from '../../utils/logger';
import * as crypto from 'crypto';

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
 * - Atomic log rotation with file locking
 * - Configurable retention period for log files
 * - Separate log file for each tunnel
 * - Structured event logging with timestamps
 */
export class TunnelLogger {
    private readonly logDir: string;
    private readonly maxLogSize = 10 * 1024 * 1024; // 10MB
    private readonly maxLogFiles = 5;
    private readonly lockMap: Map<string, boolean> = new Map();
    private readonly activeStreams: Map<string, fs.WriteStream> = new Map();

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
        
        // Close existing stream if it exists
        const existingStream = this.activeStreams.get(tunnelId);
        if (existingStream) {
            existingStream.end();
            this.activeStreams.delete(tunnelId);
        }

        const stream = fs.createWriteStream(logFile, { flags: 'a' });
        this.activeStreams.set(tunnelId, stream);
        
        return stream;
    }

    /**
     * Logs a tunnel event with optional details
     * @param tunnelId The ID of the tunnel
     * @param event The event description
     * @param details Optional event details
     */
    async logTunnelEvent(tunnelId: string, event: string, details?: any): Promise<void> {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] Tunnel ${tunnelId}: ${event}${details ? ` - ${JSON.stringify(details)}` : ''}\n`;
        
        // Pass preserveFocus option if it exists in details
        const preserveFocus = details?.preserveFocus;
        this.baseLogger.info(LogComponent.TUNNEL, logMessage.trim(), { preserveFocus });
        
        try {
            let stream = this.activeStreams.get(tunnelId);
            
            // If stream exists but is in an error state or ended, create a new one
            if (stream?.destroyed || stream?.writableEnded) {
                stream = this.createLogStream(tunnelId);
            } else if (!stream) {
                stream = this.createLogStream(tunnelId);
            }

            // Use promisified write to ensure message is written before checking size
            await new Promise<void>((resolve, reject) => {
                if (!stream.writable) {
                    reject(new Error('Stream is not writable'));
                    return;
                }
                stream.write(logMessage, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            await this.checkAndRotateLogs(tunnelId);
        } catch (error) {
            this.baseLogger.error(LogComponent.TUNNEL, `Error writing to log: ${error}`);
        }
    }

    /**
     * Acquires a lock for a tunnel's log operations
     * @param tunnelId The ID of the tunnel
     * @private
     */
    private async acquireLock(tunnelId: string): Promise<boolean> {
        if (this.lockMap.get(tunnelId)) {
            return false;
        }
        this.lockMap.set(tunnelId, true);
        return true;
    }

    /**
     * Releases a lock for a tunnel's log operations
     * @param tunnelId The ID of the tunnel
     * @private
     */
    private releaseLock(tunnelId: string): void {
        this.lockMap.delete(tunnelId);
    }

    /**
     * Checks if log rotation is needed and performs rotation if necessary
     * @param tunnelId The ID of the tunnel
     * @private
     */
    private async checkAndRotateLogs(tunnelId: string): Promise<void> {
        const logFile = path.join(this.logDir, `${tunnelId}.log`);
        
        try {
            const stats = await fsPromises.stat(logFile);
            if (stats.size > this.maxLogSize) {
                if (await this.acquireLock(tunnelId)) {
                    try {
                        await this.rotateLogs(tunnelId);
                    } finally {
                        this.releaseLock(tunnelId);
                    }
                }
            }
        } catch (error) {
            this.baseLogger.error(LogComponent.TUNNEL, `Error checking log size: ${error}`);
        }
    }

    /**
     * Performs atomic log rotation for a tunnel's log files
     * @param tunnelId The ID of the tunnel
     * @private
     */
    private async rotateLogs(tunnelId: string): Promise<void> {
        const baseLogFile = path.join(this.logDir, `${tunnelId}.log`);
        
        try {
            // Close the active stream if it exists and wait for it to fully close
            const activeStream = this.activeStreams.get(tunnelId);
            if (activeStream) {
                await new Promise<void>((resolve, reject) => {
                    activeStream.end((err: Error | null) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                this.activeStreams.delete(tunnelId);
                // Wait a bit to ensure the file handle is fully released
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Shift existing log files
            for (let i = this.maxLogFiles - 1; i > 0; i--) {
                const oldFile = path.join(this.logDir, `${tunnelId}.${i}.log`);
                const newFile = path.join(this.logDir, `${tunnelId}.${i + 1}.log`);
                
                if (fs.existsSync(oldFile)) {
                    await fsPromises.rename(oldFile, newFile);
                }
            }

            // Move current log to .1 if it exists
            if (fs.existsSync(baseLogFile)) {
                const firstRotatedLog = path.join(this.logDir, `${tunnelId}.1.log`);
                await fsPromises.rename(baseLogFile, firstRotatedLog);
            }

            // Create new empty log file with initial content
            const timestamp = new Date().toISOString();
            const initialContent = `[${timestamp}] Log file created for tunnel ${tunnelId}\n`;
            await fsPromises.writeFile(baseLogFile, initialContent);

            // Create a new stream for the rotated log and wait for it to be ready
            const newStream = this.createLogStream(tunnelId);
            await new Promise<void>((resolve) => {
                newStream.once('open', resolve);
            });

            // Write an initial rotation message
            const rotationMessage = `[${timestamp}] Log rotation completed\n`;
            await new Promise<void>((resolve, reject) => {
                newStream.write(rotationMessage, (err: Error | null | undefined) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (error) {
            this.baseLogger.error(LogComponent.TUNNEL, `Error during log rotation: ${error}`);
            // Attempt to ensure a valid log file exists even after error
            if (!fs.existsSync(baseLogFile)) {
                const timestamp = new Date().toISOString();
                const recoveryContent = `[${timestamp}] Log file recovered after rotation error\n`;
                await fsPromises.writeFile(baseLogFile, recoveryContent);
                const newStream = this.createLogStream(tunnelId);
                await new Promise<void>((resolve) => {
                    newStream.once('open', resolve);
                });
            }
        }
    }

    /**
     * Cleans up log files older than 7 days
     * This helps prevent disk space issues from abandoned or inactive tunnels
     */
    async cleanupOldLogs(): Promise<void> {
        try {
            const files = await fsPromises.readdir(this.logDir);
            const now = Date.now();
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

            await Promise.all(files.map(async (file) => {
                try {
                    const filePath = path.join(this.logDir, file);
                    const stats = await fsPromises.stat(filePath);
                    
                    if (now - stats.mtime.getTime() > maxAge) {
                        await fsPromises.unlink(filePath);
                        this.baseLogger.info(LogComponent.TUNNEL, `Deleted old log file: ${file}`);
                    }
                } catch (error) {
                    this.baseLogger.error(LogComponent.TUNNEL, `Error processing file ${file}: ${error}`);
                }
            }));
        } catch (error) {
            this.baseLogger.error(LogComponent.TUNNEL, `Error cleaning up old logs: ${error}`);
        }
    }

    /**
     * Closes all active write streams
     * Should be called when shutting down the logger
     */
    async dispose(): Promise<void> {
        for (const [tunnelId, stream] of this.activeStreams) {
            stream.end();
        }
        this.activeStreams.clear();
        this.lockMap.clear();
    }
} 