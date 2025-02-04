/**
 * Logger - Unified Logging System for Tunnelfy
 * 
 * This class provides a centralized logging system that:
 * 1. Outputs to VS Code's output channel
 * 2. Writes to rotating log files
 * 3. Supports different log levels (DEBUG, INFO, WARN, ERROR)
 * 4. Handles log rotation to prevent excessive disk usage
 * 
 * Features:
 * - Singleton pattern ensures consistent logging across the extension
 * - Automatic log rotation when files exceed 5MB
 * - Component-based logging for better organization
 * - Supports both VS Code output and file-based logging
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * LogComponent - Defines different components of the system for organized logging
 * This helps track which part of the system generated each log message
 */
export enum LogComponent {
    EXTENSION = 'EXTENSION',  // Core extension operations
    TUNNEL = 'TUNNEL',       // Tunnel-related operations
    COMMAND = 'COMMAND',     // Command execution
    PROFILE = 'PROFILE'      // Profile management
}

/**
 * LogLevel - Defines the severity levels for logging
 * Higher numbers indicate more severe levels
 */
export enum LogLevel {
    DEBUG = 1,  // Detailed information for debugging
    INFO = 2,   // General information about operation progress
    WARN = 3,   // Warnings that don't prevent operation but need attention
    ERROR = 4   // Errors that prevent normal operation
}

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logDir!: string;
    private logFile!: string;
    private fileStream: fs.WriteStream | null = null;
    private maxFileSize: number = 5 * 1024 * 1024; // 5MB
    private currentLogLevel: LogLevel = LogLevel.INFO;

    /**
     * Private constructor to enforce singleton pattern
     * Creates the VS Code output channel for logging
     */
    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Tunnelfy');
    }

    /**
     * Gets the singleton instance of the Logger
     * Creates the instance if it doesn't exist
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Initializes the logger with the extension context
     * Sets up log directory and file streams
     * @param context - VS Code extension context
     */
    public static initialize(context: vscode.ExtensionContext): Logger {
        const logger = Logger.getInstance();
        context.subscriptions.push(logger.outputChannel);

        // Set up log directory and file
        logger.logDir = path.join(context.extensionPath, 'logs');
        logger.logFile = path.join(logger.logDir, 'extension.log');
        
        // Ensure log directory exists
        if (!fs.existsSync(logger.logDir)) {
            fs.mkdirSync(logger.logDir, { recursive: true });
        }

        // Initialize file stream
        logger.initializeFileStream();

        return logger;
    }

    /**
     * Initializes or rotates the log file stream
     * Handles log rotation when file size exceeds maxFileSize
     */
    private initializeFileStream(): void {
        try {
            // Check if log file exists and its size
            if (fs.existsSync(this.logFile)) {
                const stats = fs.statSync(this.logFile);
                if (stats.size >= this.maxFileSize) {
                    // Rotate log file
                    const backupFile = `${this.logFile}.1`;
                    if (fs.existsSync(backupFile)) {
                        fs.unlinkSync(backupFile);
                    }
                    fs.renameSync(this.logFile, backupFile);
                }
            }

            // Create or open log file stream in append mode
            this.fileStream = fs.createWriteStream(this.logFile, { flags: 'a' });
        } catch (error) {
            console.error('Failed to initialize log file stream:', error);
        }
    }

    /**
     * Sets the minimum log level to display
     * Messages below this level will be ignored
     * @param level - The minimum log level to show
     */
    public setLogLevel(level: LogLevel): void {
        this.currentLogLevel = level;
    }

    /**
     * Cleans up resources when the logger is no longer needed
     * Closes file streams and disposes of the output channel
     */
    public dispose(): void {
        if (this.fileStream) {
            this.fileStream.end();
        }
        this.outputChannel.dispose();
    }

    /**
     * Formats a log message with timestamp and metadata
     * @param level - The log level string
     * @param component - The component generating the log
     * @param message - The main log message
     * @param args - Additional arguments to log
     */
    private formatMessage(level: string, component: LogComponent | string, message: string, ...args: any[]): string {
        const timestamp = new Date().toISOString();
        const formattedArgs = args.map(arg => {
            if (arg instanceof Error) {
                return arg.stack || arg.message;
            }
            if (typeof arg === 'object') {
                return JSON.stringify(arg);
            }
            return String(arg);
        }).join(' ');

        return `[${timestamp}] [${level}] [${component}] ${message}${formattedArgs ? ' ' + formattedArgs : ''}`;
    }

    /**
     * Core logging function that handles all log levels
     * Writes to both VS Code output and log file if level is sufficient
     */
    private writeLog(level: LogLevel, levelStr: string, component: LogComponent | string, message: string, ...args: any[]): void {
        if (level < this.currentLogLevel) {
            return;
        }

        const formattedMessage = this.formatMessage(levelStr, component, message, ...args);
        
        // Write to VS Code output channel
        this.outputChannel.appendLine(formattedMessage);

        // Write to log file if stream is available
        if (this.fileStream) {
            this.fileStream.write(formattedMessage + '\n');
        }

        // Show output channel for important messages
        if (level >= LogLevel.ERROR || 
            (level >= LogLevel.WARN && !message.includes('Running tunnel')) || 
            message.includes('Extension activated')) {
            this.outputChannel.show(true);
        }
    }

    /**
     * Logs a debug message - Detailed information for debugging
     */
    public debug(component: LogComponent | string, message: string, ...args: any[]): void {
        this.writeLog(LogLevel.DEBUG, 'DEBUG', component, message, ...args);
    }

    /**
     * Logs an info message - General operational information
     */
    public info(component: LogComponent | string, message?: string, ...args: any[]): void {
        // Fallback to handle single-argument calls
        if (typeof message === 'undefined') {
            message = component as string;
            component = LogComponent.EXTENSION;
        }
        this.writeLog(LogLevel.INFO, 'INFO', component, message, ...args);
    }

    /**
     * Logs a warning message - Issues that need attention but don't stop operation
     */
    public warn(component: LogComponent | string, message: string, ...args: any[]): void {
        this.writeLog(LogLevel.WARN, 'WARN', component, message, ...args);
    }

    /**
     * Logs an error message - Critical issues that prevent normal operation
     */
    public error(component: LogComponent | string, message: string, ...args: any[]): void {
        this.writeLog(LogLevel.ERROR, 'ERROR', component, message, ...args);
    }

    /**
     * Manually shows the output channel
     * Useful when you want to force the log to be visible
     */
    public show(): void {
        this.outputChannel.show();
    }
}
