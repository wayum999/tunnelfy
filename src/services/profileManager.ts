/**
 * ProfileManager - Manages Cloudflare API profiles
 * 
 * This service handles the storage and management of Cloudflare API profiles.
 * Each profile contains:
 * - API key for authentication
 * - Account ID for API requests
 * - Profile name for identification
 * 
 * Key responsibilities:
 * 1. Secure storage of API credentials
 * 2. Profile CRUD operations
 * 3. Active profile management
 * 4. Profile validation
 * 5. Cloudflared installation checks
 * 
 * Security features:
 * - API keys stored in VS Code's secure storage
 * - Input validation for profile data
 * - Account ID verification
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { promisify } from 'util';
import { Logger, LogComponent } from '../utils/logger';

const exec = promisify(cp.exec);

/**
 * Interface representing a Cloudflare profile
 * Contains all necessary information for API authentication
 * Note: Sensitive data (API key and account ID) are stored in secure storage
 */
interface Profile {
    /** Unique name for the profile */
    name: string;
}

export class ProfileManager {
    private readonly cloudflaredDir: string;
    private readonly logger = Logger.getInstance();
    private readonly STORAGE_KEY = 'cloudflare.profiles';
    private readonly ACTIVE_PROFILE_KEY = 'cloudflare.activeProfile';
    private readonly ACCOUNT_ID_PREFIX = 'cloudflare.account.';
    private readonly API_KEY_PREFIX = 'cloudflare.apikey.';
    private profiles: Map<string, Profile> = new Map();
    private activeProfile: string | null = null;

    /**
     * Initializes the ProfileManager
     * @param context VS Code extension context for storage access
     */
    constructor(private context: vscode.ExtensionContext) {
        this.cloudflaredDir = path.join(os.homedir(), '.cloudflared');
        this.loadProfiles();
        this.logger.debug(LogComponent.PROFILE, 'ProfileManager initialized');
        this.migrateToSecureStorage();
    }

    /**
     * Loads profiles from persistent storage
     * Initializes empty state if loading fails
     * @private
     */
    private loadProfiles(): void {
        try {
            // Load profiles from globalState
            const storedProfiles = this.context.globalState.get<{ [key: string]: Profile }>(this.STORAGE_KEY);
            if (storedProfiles) {
                this.profiles = new Map(Object.entries(storedProfiles));
                this.logger.debug(LogComponent.PROFILE, `Loaded ${this.profiles.size} profiles from storage`);
            }

            // Load active profile from globalState
            this.activeProfile = this.context.globalState.get<string | null>(this.ACTIVE_PROFILE_KEY, null);
            if (this.activeProfile) {
                this.logger.debug(LogComponent.PROFILE, `Loaded active profile: ${this.activeProfile}`);
            }
        } catch (error) {
            this.logger.error(LogComponent.PROFILE, 'Failed to load profiles:', error);
            // Initialize empty state on error
            this.profiles = new Map();
            this.activeProfile = null;
        }
    }

    /**
     * Migrates existing account IDs and API keys to secure storage
     * @private
     */
    private async migrateToSecureStorage(): Promise<void> {
        try {
            // Skip migration if no profiles exist
            if (this.profiles.size === 0) {
                this.logger.debug(LogComponent.PROFILE, 'No profiles to migrate');
                return;
            }

            for (const [name, profile] of this.profiles.entries()) {
                // Handle legacy profile format that might have accountId and apiKey
                const legacyProfile = profile as { 
                    name: string; 
                    accountId?: string;
                    apiKey?: string;
                };

                // Migrate account ID if present
                if (legacyProfile.accountId) {
                    this.logger.debug(LogComponent.PROFILE, `Migrating account ID for profile: ${name}`);
                    await this.context.secrets.store(
                        this.getAccountIdKey(name),
                        legacyProfile.accountId
                    );
                    delete legacyProfile.accountId;
                }

                // Migrate API key if present
                if (legacyProfile.apiKey) {
                    this.logger.debug(LogComponent.PROFILE, `Migrating API key for profile: ${name}`);
                    await this.context.secrets.store(
                        this.getApiKeyKey(name),
                        legacyProfile.apiKey
                    );
                    delete legacyProfile.apiKey;
                }
            }

            // Save the cleaned up profiles without sensitive data
            await this.saveProfiles();
            this.logger.info(LogComponent.PROFILE, 'Migration to secure storage completed successfully');
        } catch (error) {
            this.logger.error(LogComponent.PROFILE, 'Failed to migrate to secure storage:', error);
            throw new Error('Failed to migrate profiles to secure storage');
        }
    }

    /**
     * Gets the secure storage key for an account ID
     * @param name Profile name
     * @returns Secure storage key
     * @private
     */
    private getAccountIdKey(name: string): string {
        return `${this.ACCOUNT_ID_PREFIX}${name}`;
    }

    /**
     * Gets the secure storage key for an API key
     * @param name Profile name
     * @returns Secure storage key
     * @private
     */
    private getApiKeyKey(name: string): string {
        return `${this.API_KEY_PREFIX}${name}`;
    }

    /**
     * Saves profiles to persistent storage
     * @throws Error if saving fails
     * @private
     */
    private async saveProfiles(): Promise<void> {
        try {
            // Convert Map to object for storage
            const profilesObj = Object.fromEntries(this.profiles.entries());
            
            // Save profiles and active profile
            await Promise.all([
                this.context.globalState.update(this.STORAGE_KEY, profilesObj),
                this.context.globalState.update(this.ACTIVE_PROFILE_KEY, this.activeProfile)
            ]);
            
            this.logger.debug(
                LogComponent.PROFILE, 
                `Saved ${this.profiles.size} profiles${this.activeProfile ? `, active: ${this.activeProfile}` : ''}`
            );
        } catch (error) {
            this.logger.error(LogComponent.PROFILE, 'Failed to save profiles:', error);
            throw error;
        }
    }

    /**
     * Creates a new profile
     * @param name Name for the new profile
     * @param apiKey API key for authentication
     * @param accountId Account ID for API requests
     * @throws Error if validation fails or profile already exists
     */
    async createProfile(name: string, apiKey: string, accountId: string): Promise<void> {
        if (!name || !name.trim()) {
            throw new Error('Profile name cannot be empty');
        }

        if (!apiKey || !apiKey.trim()) {
            throw new Error('API key cannot be empty');
        }

        if (!accountId || !accountId.trim()) {
            throw new Error('Account ID cannot be empty');
        }

        // Validate profile name format
        if (!/^[a-zA-Z0-9-_ ]+$/.test(name)) {
            throw new Error('Profile name can only contain letters, numbers, spaces, hyphens, and underscores');
        }

        // Validate account ID format
        if (!/^[a-f0-9]{32}$/i.test(accountId)) {
            throw new Error('Account ID must be a 32-character hexadecimal string');
        }

        if (this.profiles.has(name)) {
            throw new Error(`Profile '${name}' already exists`);
        }

        try {
            // Store API key and account ID in secure storage
            await Promise.all([
                this.context.secrets.store(this.getApiKeyKey(name), apiKey),
                this.context.secrets.store(this.getAccountIdKey(name), accountId)
            ]);

            // Create profile without sensitive data
            const profile: Profile = { name };
            this.profiles.set(name, profile);
            await this.saveProfiles();
            
            // Make this profile active if it's the first one or there's no active profile
            if (!this.activeProfile || this.profiles.size === 1) {
                this.activeProfile = name;
                await this.saveProfiles();
                this.logger.info(LogComponent.PROFILE, `Set ${name} as active profile`);
            }

            this.logger.info(LogComponent.PROFILE, `Profile ${name} created successfully`);
        } catch (error) {
            // Clean up if anything fails
            await Promise.all([
                this.context.secrets.delete(this.getApiKeyKey(name)),
                this.context.secrets.delete(this.getAccountIdKey(name))
            ]);
            throw error;
        }
    }

    /**
     * Deletes a profile
     * @param name Name of the profile to delete
     * @throws Error if profile doesn't exist
     */
    async deleteProfile(name: string): Promise<void> {
        if (!this.profiles.has(name)) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        try {
            // Delete sensitive data from secure storage
            await Promise.all([
                this.context.secrets.delete(this.getApiKeyKey(name)),
                this.context.secrets.delete(this.getAccountIdKey(name))
            ]);

            this.profiles.delete(name);
            
            // If this was the active profile, clear it
            if (this.activeProfile === name) {
                this.activeProfile = null;
            }

            await this.saveProfiles();
            this.logger.info(LogComponent.PROFILE, `Profile ${name} deleted successfully`);
        } catch (error) {
            this.logger.error(LogComponent.PROFILE, `Failed to delete profile ${name}:`, error);
            throw error;
        }
    }

    /**
     * Lists all available profiles
     * @returns Array of profile names
     */
    listProfiles(): string[] {
        return Array.from(this.profiles.keys());
    }

    /**
     * Gets the active profile
     * @returns Name of active profile or null if none active
     */
    async getActiveProfile(): Promise<string | null> {
        return this.activeProfile;
    }

    /**
     * Checks if the given profile is the active one
     * @param name Name of profile to check
     * @returns true if profile is active
     */
    async isActiveProfile(name: string): Promise<boolean> {
        return this.activeProfile === name;
    }

    /**
     * Sets the active profile
     * @param name Name of profile to set as active
     * @throws Error if profile doesn't exist
     */
    async setActiveProfile(name: string): Promise<void> {
        if (!this.profiles.has(name)) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        this.activeProfile = name;
        await this.saveProfiles();
        this.logger.info(LogComponent.PROFILE, `Active profile set to ${name}`);
    }

    /**
     * Gets the API key for a profile from secure storage
     * @param name Name of profile
     * @returns API key or null if not found
     */
    async getProfileApiKey(name: string): Promise<string | null> {
        try {
            const apiKey = await this.context.secrets.get(this.getApiKeyKey(name));
            return apiKey || null;
        } catch (error) {
            this.logger.error(LogComponent.PROFILE, `Failed to get API key for profile ${name}:`, error);
            return null;
        }
    }

    /**
     * Gets the account ID for a profile from secure storage
     * @param name Name of profile
     * @returns Account ID or null if not found
     */
    async getProfileAccountId(name: string): Promise<string | null> {
        try {
            const accountId = await this.context.secrets.get(this.getAccountIdKey(name));
            return accountId || null;
        } catch (error) {
            this.logger.error(LogComponent.PROFILE, `Failed to get account ID for profile ${name}:`, error);
            return null;
        }
    }

    /**
     * Sets the account ID for a profile in secure storage
     * @param name Name of profile
     * @param accountId Account ID to set
     * @throws Error if profile doesn't exist or validation fails
     */
    async setProfileAccountId(name: string, accountId: string): Promise<void> {
        if (!this.profiles.has(name)) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        if (!accountId || !accountId.trim()) {
            throw new Error('Account ID cannot be empty');
        }

        // Validate account ID format
        if (!/^[a-f0-9]{32}$/i.test(accountId)) {
            throw new Error('Account ID must be a 32-character hexadecimal string');
        }

        try {
            await this.context.secrets.store(this.getAccountIdKey(name), accountId);
            this.logger.debug(LogComponent.PROFILE, `Account ID set for profile ${name}`);
        } catch (error) {
            this.logger.error(LogComponent.PROFILE, `Failed to set account ID for profile ${name}:`, error);
            throw error;
        }
    }

    /**
     * Updates the API key for a profile in secure storage
     * @param name Name of profile
     * @param apiKey New API key
     * @throws Error if profile doesn't exist or validation fails
     */
    async updateProfileApiKey(name: string, apiKey: string): Promise<void> {
        if (!this.profiles.has(name)) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        if (!apiKey || !apiKey.trim()) {
            throw new Error('API key cannot be empty');
        }

        try {
            await this.context.secrets.store(this.getApiKeyKey(name), apiKey);
            this.logger.info(LogComponent.PROFILE, `Updated API key for profile ${name}`);
        } catch (error) {
            this.logger.error(LogComponent.PROFILE, `Failed to update API key for profile ${name}:`, error);
            throw error;
        }
    }

    /**
     * Checks if cloudflared is installed
     * @returns true if cloudflared is installed and accessible
     */
    async isCloudflaredInstalled(): Promise<boolean> {
        // On Linux, check common installation paths if the direct command fails
        const checkPaths = process.platform === 'linux' ? [
            'cloudflared',
            '/usr/local/bin/cloudflared',
            '/usr/bin/cloudflared',
            '/opt/cloudflared/bin/cloudflared',
            `${process.env.HOME}/.local/bin/cloudflared`,
            '/snap/bin/cloudflared'
        ] : ['cloudflared'];
        
        for (const cloudflaredPath of checkPaths) {
            try {
                await exec(`${cloudflaredPath} --version`);
                this.logger.info(LogComponent.PROFILE, `Cloudflared is installed${cloudflaredPath !== 'cloudflared' ? ` at ${cloudflaredPath}` : ''}`);
                return true;
            } catch (error) {
                // Continue to next path
                continue;
            }
        }
        
        // If we get here, cloudflared was not found in any location
        this.logger.error(LogComponent.PROFILE, 'Cloudflared is not installed', 'Not found in PATH or common locations');
        return false;
    }
}