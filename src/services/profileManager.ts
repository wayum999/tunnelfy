/**
 * ProfileManager - Manages Cloudflare API profiles
 * 
 * This service handles the storage and management of Cloudflare API profiles.
 * Each profile contains:
 * - API key for authentication
 * - Account ID for API requests
 * - Profile name for identification
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { promisify } from 'util';
import { Logger, LogComponent } from '../utils/logger';

const exec = promisify(cp.exec);

interface Profile {
    name: string;
    apiKey: string;
    accountId?: string;
}

export class ProfileManager {
    private readonly cloudflaredDir: string;
    private readonly logger = Logger.getInstance();
    private readonly STORAGE_KEY = 'cloudflare.profiles';
    private readonly ACTIVE_PROFILE_KEY = 'cloudflare.activeProfile';
    private profiles: Map<string, Profile> = new Map();
    private activeProfile: string | null = null;

    /**
     * Initializes the ProfileManager
     */
    constructor(private context: vscode.ExtensionContext) {
        this.cloudflaredDir = path.join(os.homedir(), '.cloudflared');
        this.loadProfiles();
        this.logger.debug(LogComponent.PROFILE, 'ProfileManager initialized');
    }

    /**
     * Loads profiles from persistent storage
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
     * Saves profiles to persistent storage
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
        if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
            throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
        }

        // Validate account ID format
        if (!/^[a-f0-9]{32}$/i.test(accountId)) {
            throw new Error('Account ID must be a 32-character hexadecimal string');
        }

        if (this.profiles.has(name)) {
            throw new Error(`Profile '${name}' already exists`);
        }

        // Create and save the profile
        const profile: Profile = { name, apiKey, accountId };
        this.profiles.set(name, profile);
        await this.saveProfiles();
        
        // Make this profile active if it's the first one or there's no active profile
        if (!this.activeProfile || this.profiles.size === 1) {
            this.activeProfile = name;
            await this.saveProfiles();
            this.logger.info(LogComponent.PROFILE, `Set ${name} as active profile`);
        }

        this.logger.info(LogComponent.PROFILE, `Profile ${name} created successfully`);
    }

    /**
     * Deletes a profile
     */
    async deleteProfile(name: string): Promise<void> {
        if (!this.profiles.has(name)) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        this.profiles.delete(name);
        
        // If this was the active profile, clear it
        if (this.activeProfile === name) {
            this.activeProfile = null;
        }

        await this.saveProfiles();
        this.logger.info(LogComponent.PROFILE, `Profile ${name} deleted successfully`);
    }

    /**
     * Lists all profiles
     */
    listProfiles(): string[] {
        return Array.from(this.profiles.keys());
    }

    /**
     * Gets the active profile
     */
    async getActiveProfile(): Promise<string | null> {
        return this.activeProfile;
    }

    /**
     * Sets the active profile
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
     * Gets the API key for a profile
     */
    async getProfileApiKey(name: string): Promise<string | null> {
        const profile = this.profiles.get(name);
        return profile?.apiKey || null;
    }

    /**
     * Gets the account ID for a profile
     */
    async getProfileAccountId(name: string): Promise<string | null> {
        const profile = this.profiles.get(name);
        return profile?.accountId || null;
    }

    /**
     * Sets the account ID for a profile
     */
    async setProfileAccountId(name: string, accountId: string): Promise<void> {
        const profile = this.profiles.get(name);
        if (!profile) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        profile.accountId = accountId;
        await this.saveProfiles();
        this.logger.debug(LogComponent.PROFILE, `Account ID set for profile ${name}`);
    }

    /**
     * Checks if cloudflared is installed
     */
    async isCloudflaredInstalled(): Promise<boolean> {
        try {
            await exec('cloudflared --version');
            this.logger.info(LogComponent.PROFILE, 'Cloudflared is installed');
            return true;
        } catch (error: unknown) {
            if (error instanceof Error) {
                this.logger.error(LogComponent.PROFILE, 'Cloudflared is not installed', error.message);
            } else {
                this.logger.error(LogComponent.PROFILE, 'Cloudflared is not installed', String(error));
            }
            return false;
        }
    }

    /**
     * Switches to a different profile
     */
    async switchProfile(name: string): Promise<void> {
        if (!this.profiles.has(name)) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        this.activeProfile = name;
        await this.saveProfiles();
        this.logger.info(LogComponent.PROFILE, `Switched to profile ${name}`);
    }

    /**
     * Updates the API key for a profile
     */
    async updateProfileApiKey(name: string, apiKey: string): Promise<void> {
        const profile = this.profiles.get(name);
        if (!profile) {
            throw new Error(`Profile '${name}' does not exist`);
        }

        if (!apiKey || !apiKey.trim()) {
            throw new Error('API key cannot be empty');
        }

        profile.apiKey = apiKey;
        await this.saveProfiles();
        this.logger.info(LogComponent.PROFILE, `Updated API key for profile ${name}`);
    }
}