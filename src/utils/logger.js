"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.LogLevel = exports.LogComponent = void 0;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
/**
 * LogComponent - Defines different components of the system for organized logging
 * This helps track which part of the system generated each log message
 */
var LogComponent;
(function (LogComponent) {
    LogComponent["EXTENSION"] = "EXTENSION";
    LogComponent["TUNNEL"] = "TUNNEL";
    LogComponent["COMMAND"] = "COMMAND";
    LogComponent["PROFILE"] = "PROFILE"; // Profile management
})(LogComponent || (exports.LogComponent = LogComponent = {}));
/**
 * LogLevel - Defines the severity levels for logging
 * Higher numbers indicate more severe levels
 */
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 1] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 2] = "INFO";
    LogLevel[LogLevel["WARN"] = 3] = "WARN";
    LogLevel[LogLevel["ERROR"] = 4] = "ERROR"; // Errors that prevent normal operation
})(LogLevel || (exports.LogLevel = LogLevel = {}));
class Logger {
    /**
     * Private constructor to enforce singleton pattern
     * Creates the VS Code output channel for logging
     */
    constructor() {
        this.fileStream = null;
        this.maxFileSize = 5 * 1024 * 1024; // 5MB
        this.currentLogLevel = LogLevel.INFO;
        this.outputChannel = vscode.window.createOutputChannel('Tunnelfy');
    }
    /**
     * Gets the singleton instance of the Logger
     * Creates the instance if it doesn't exist
     */
    static getInstance() {
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
    static initialize(context) {
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
    initializeFileStream() {
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
        }
        catch (error) {
            console.error('Failed to initialize log file stream:', error);
        }
    }
    /**
     * Sets the minimum log level to display
     * Messages below this level will be ignored
     * @param level - The minimum log level to show
     */
    setLogLevel(level) {
        this.currentLogLevel = level;
    }
    /**
     * Cleans up resources when the logger is no longer needed
     * Closes file streams and disposes of the output channel
     */
    dispose() {
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
    formatMessage(level, component, message, ...args) {
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
    writeLog(level, levelStr, component, message, ...args) {
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
    debug(component, message, ...args) {
        this.writeLog(LogLevel.DEBUG, 'DEBUG', component, message, ...args);
    }
    /**
     * Logs an info message - General operational information
     */
    info(component, message, ...args) {
        // Fallback to handle single-argument calls
        if (typeof message === 'undefined') {
            message = component;
            component = LogComponent.EXTENSION;
        }
        this.writeLog(LogLevel.INFO, 'INFO', component, message, ...args);
    }
    /**
     * Logs a warning message - Issues that need attention but don't stop operation
     */
    warn(component, message, ...args) {
        this.writeLog(LogLevel.WARN, 'WARN', component, message, ...args);
    }
    /**
     * Logs an error message - Critical issues that prevent normal operation
     */
    error(component, message, ...args) {
        this.writeLog(LogLevel.ERROR, 'ERROR', component, message, ...args);
    }
    /**
     * Manually shows the output channel
     * Useful when you want to force the log to be visible
     */
    show() {
        this.outputChannel.show();
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map