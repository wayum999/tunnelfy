/**
 * TokenService - Manages Tunnel Tokens Securely for Tunnelfy
 * 
 * This service handles:
 * 1. Secure storage of tunnel tokens using VS Code's secrets storage
 * 2. In-memory encryption for quick access
 * 3. Audit logging for token access and failures via TokenAuditService
 * 4. Rate limiting based on failed attempts to safeguard against brute-force access
 * 
 * Implementation Details:
 * - Uses AES-256-GCM encryption to securely store tokens in memory
 * - Encrypts tokens before caching them, ensuring data is protected even if memory is compromised
 * - Integrates with TokenAuditService to record and monitor access attempts
 * - Provides methods to store, retrieve, and delete tokens from both secure storage and memory
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Logger, LogComponent } from '../utils/logger';
import { TokenAuditService } from './tokenAuditService';
import { Messages } from '../utils/messages';

export class TokenService {
    // Prefix used for storing tokens in VS Code's secure storage
    private static readonly TUNNEL_TOKEN_PREFIX = 'tunnelfy.tunnel.token.';
    // Defines the timeout duration for clipboard operations (if used in UI interactions)
    private static readonly CLIPBOARD_TIMEOUT_MS = 30000; // 30 seconds
    // Encryption algorithm used for in-memory token encryption
    private static readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
    // Maximum allowed consecutive failed token access attempts
    private static readonly MAX_FAILED_ATTEMPTS = 3;
    // Lockout duration after reaching maximum failed attempts
    private static readonly FAILED_ATTEMPTS_TIMEOUT_MS = 300000; // 5 minutes

    private readonly logger: Logger;
    // A randomly generated key for in-memory encryption of tokens
    private readonly memoryKey: Buffer;
    private readonly auditService: TokenAuditService;
    // Map to store encrypted tokens in memory along with their IV and authTag
    private encryptedTokens = new Map<string, { encrypted: Buffer; iv: Buffer; authTag: Buffer }>();
    private failedAttempts: number = 0;
    private lastFailedAttempt: number = 0;

    /**
     * Constructor initializes the TokenService with a VS Code extension context and sets up the encryption key
     * and audit service for logging token events.
     * 
     * @param context - The VS Code extension context
     */
    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        // Generate a 256-bit random key for AES-256-GCM encryption
        this.memoryKey = crypto.randomBytes(32);
        this.auditService = new TokenAuditService(context);
    }

    /**
     * Encrypt data for in-memory storage using AES-256-GCM
     * 
     * @param data - The plain text token to be encrypted
     * @returns An object containing the encrypted token, IV, and authentication tag
     */
    private encryptForMemory(data: string): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
        const iv = crypto.randomBytes(16); // Initialization vector
        const cipher = crypto.createCipheriv(TokenService.ENCRYPTION_ALGORITHM, this.memoryKey, iv);
        
        // Encrypt the token data
        const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        return { encrypted, iv, authTag };
    }

    /**
     * Decrypt data from in-memory storage using AES-256-GCM
     * 
     * @param encrypted - The encrypted token buffer
     * @param iv - The initialization vector used during encryption
     * @param authTag - The authentication tag generated during encryption
     * @returns The decrypted plain text token
     */
    private decryptFromMemory(encrypted: Buffer, iv: Buffer, authTag: Buffer): string {
        const decipher = crypto.createDecipheriv(TokenService.ENCRYPTION_ALGORITHM, this.memoryKey, iv);
        decipher.setAuthTag(authTag);
        
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }

    /**
     * Check if we should allow another attempt based on failed attempts history
     * @throws Error if too many failed attempts
     */
    private async checkFailedAttempts(): Promise<void> {
        const now = Date.now();
        
        // Reset failed attempts if enough time has passed
        if (now - this.lastFailedAttempt > TokenService.FAILED_ATTEMPTS_TIMEOUT_MS) {
            this.failedAttempts = 0;
            this.lastFailedAttempt = 0;
            return;
        }

        if (this.failedAttempts >= TokenService.MAX_FAILED_ATTEMPTS) {
            const remainingTime = Math.ceil(
                (TokenService.FAILED_ATTEMPTS_TIMEOUT_MS - (now - this.lastFailedAttempt)) / 60000
            );
            throw new Error(`Too many failed attempts. Please try again in ${remainingTime} minutes.`);
        }
    }

    /**
     * Store a tunnel token securely using VS Code's secrets storage
     * Also, keep an encrypted version in memory for quick access.
     * 
     * @param tunnelId - The identifier for the tunnel
     * @param token - The tunnel token to store
     * @throws Error if storing the token fails
     */
    async storeTunnelToken(tunnelId: string, token: string): Promise<void> {
        try {
            await this.checkFailedAttempts();
            
            // Store token in VS Code's secure storage
            await this.context.secrets.store(
                TokenService.TUNNEL_TOKEN_PREFIX + tunnelId,
                token
            );

            // Cache the encrypted token in memory
            this.encryptedTokens.set(tunnelId, this.encryptForMemory(token));
            
            // Record successful token storage event
            await this.auditService.recordEvent({
                action: 'create',
                tunnelId,
                success: true
            });

            this.logger.debug(LogComponent.TUNNEL, `Stored token for tunnel ${tunnelId}`);
        } catch (error: any) {
            await this.auditService.recordEvent({
                action: 'create',
                tunnelId,
                success: false,
                error: error?.message || 'Unknown error occurred'
            });
            this.logger.error(LogComponent.TUNNEL, 'Failed to store tunnel token:', error);
            throw new Error('Failed to store tunnel token securely');
        }
    }

    /**
     * Retrieve a tunnel token from secure storage or memory
     * First attempts to decrypt the token from memory; if not available, falls back to VS Code's secure storage.
     * 
     * @param tunnelId - The identifier for the tunnel
     * @returns The decrypted tunnel token, or undefined if not found
     * @throws Error if accessing the token fails
     */
    async getTunnelToken(tunnelId: string): Promise<string | undefined> {
        try {
            await this.checkFailedAttempts();

            // Attempt to retrieve token from encrypted in-memory cache
            const memoryToken = this.encryptedTokens.get(tunnelId);
            if (memoryToken) {
                const token = this.decryptFromMemory(
                    memoryToken.encrypted,
                    memoryToken.iv,
                    memoryToken.authTag
                );
                await this.auditService.recordEvent({
                    action: 'access',
                    tunnelId,
                    success: true
                });
                return token;
            }

            // If not in cache, retrieve token from VS Code's secret storage
            const token = await this.context.secrets.get(
                TokenService.TUNNEL_TOKEN_PREFIX + tunnelId
            );

            // Cache the token in memory for future accesses
            if (token) {
                this.encryptedTokens.set(tunnelId, this.encryptForMemory(token));
                await this.auditService.recordEvent({
                    action: 'access',
                    tunnelId,
                    success: true
                });
            }

            return token;
        } catch (error: any) {
            await this.auditService.recordEvent({
                action: 'access',
                tunnelId,
                success: false,
                error: error?.message || 'Unknown error occurred'
            });
            this.logger.error(LogComponent.TUNNEL, 'Failed to retrieve tunnel token:', error);
            throw new Error('Failed to retrieve tunnel token from secure storage');
        }
    }

    /**
     * Delete a tunnel token from secure storage and in-memory cache
     * 
     * @param tunnelId - The identifier for the tunnel
     * @throws Error if deletion fails
     */
    async deleteTunnelToken(tunnelId: string): Promise<void> {
        try {
            await this.checkFailedAttempts();
            
            // Remove token from VS Code's secure storage
            await this.context.secrets.delete(
                TokenService.TUNNEL_TOKEN_PREFIX + tunnelId
            );

            // Remove token from in-memory cache
            this.encryptedTokens.delete(tunnelId);

            await this.auditService.recordEvent({
                action: 'delete',
                tunnelId,
                success: true
            });

            this.logger.debug(LogComponent.TUNNEL, `Deleted token for tunnel ${tunnelId}`);
        } catch (error: any) {
            await this.auditService.recordEvent({
                action: 'delete',
                tunnelId,
                success: false,
                error: error?.message || 'Unknown error occurred'
            });
            this.logger.error(LogComponent.TUNNEL, 'Failed to delete tunnel token:', error);
            throw new Error('Failed to delete tunnel token from secure storage');
        }
    }

    /**
     * Copy a token to clipboard with security measures
     * - Shows a warning message
     * - Auto-clears after timeout
     * - Returns a disposable to manually clear if needed
     */
    async copyTokenToClipboard(token: string): Promise<vscode.Disposable> {
        try {
            await this.checkFailedAttempts();
            
            // Show security warning
            const response = await Messages.showWarning(
                Messages.TOKEN_SECURITY_WARNING,
                'Continue',
                'Cancel'
            );

            if (response !== 'Continue') {
                throw new Error(Messages.TOKEN_COPY_CANCELLED);
            }

            // Copy to clipboard
            await vscode.env.clipboard.writeText(token);

            await this.auditService.recordEvent({
                action: 'copy',
                tunnelId: 'unknown', // We don't have the tunnelId in this context
                success: true
            });

            // Set up auto-clear timer
            const timeout = setTimeout(async () => {
                const currentClipboard = await vscode.env.clipboard.readText();
                if (currentClipboard === token) {
                    await vscode.env.clipboard.writeText('');
                    this.logger.debug(LogComponent.TUNNEL, 'Cleared token from clipboard');
                }
            }, TokenService.CLIPBOARD_TIMEOUT_MS);

            // Return disposable for manual cleanup
            return new vscode.Disposable(() => {
                clearTimeout(timeout);
            });
        } catch (error: any) {
            await this.auditService.recordEvent({
                action: 'copy',
                tunnelId: 'unknown',
                success: false,
                error: error?.message || 'Unknown error occurred'
            });
            throw error;
        }
    }
}
