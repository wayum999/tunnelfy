/**
 * ProfileManager - Manages Multiple Cloudflare Authentication Profiles
 * 
 * This service enables users to maintain multiple Cloudflare authentication profiles,
 * making it easy to switch between different Cloudflare accounts or configurations.
 * 
 * Key Features:
 * - Creates and manages multiple Cloudflare authentication profiles
 * - Handles profile switching and certificate management
 * - Maintains persistent profile configuration
 * - Provides profile verification and cleanup
 * 
 * Implementation Details:
 * - Profiles are stored in ~/.cloudflared/profiles.json
 * - Each profile has its own certificate file (cert_[profile_name].pem)
 * - Active profile's certificate is always named cert.pem
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { promisify } from 'util';
import { Logger, LogComponent } from '../utils/logger';

const exec = promisify(cp.exec);

export class ProfileManager {
    private readonly cloudflaredDir: string;
    private readonly configFile: string;
    private readonly logger: Logger;

    /**
     * Initializes the ProfileManager
     * Sets up necessary directories and configuration files
     */
    constructor() {
        this.cloudflaredDir = path.join(os.homedir(), '.cloudflared');
        this.configFile = path.join(this.cloudflaredDir, 'profiles.json');
        this.logger = Logger.getInstance();
        this.ensureConfigExists();
    }

    /**
     * Ensures the profile configuration file exists
     * Creates default configuration if none exists
     */
    private ensureConfigExists(): void {
        this.logger.debug(`Ensuring config exists at: ${this.configFile}`);
        if (!fs.existsSync(this.cloudflaredDir)) {
            this.logger.debug('Creating cloudflared directory');
            fs.mkdirSync(this.cloudflaredDir, { recursive: true });
        }
        if (!fs.existsSync(this.configFile)) {
            this.logger.debug('Creating initial profiles config file');
            fs.writeFileSync(this.configFile, JSON.stringify({
                profiles: [],
                activeProfile: null
            }, null, 2));
        }
    }

    /**
     * Reads and parses the profile configuration file
     * @returns Object containing profiles array and active profile name
     */
    private getConfig(): { profiles: string[], activeProfile: string | null } {
        try {
            this.logger.debug('Reading profiles config file');
            if (!fs.existsSync(this.configFile)) {
                this.logger.debug('Config file not found, creating default');
                this.ensureConfigExists();
                return { profiles: [], activeProfile: null };
            }
            const content = fs.readFileSync(this.configFile, 'utf8');
            const config = JSON.parse(content);
            this.logger.debug(`Found profiles: ${JSON.stringify(config.profiles)}`);
            this.logger.debug(`Active profile: ${config.activeProfile}`);
            return config;
        } catch (error: unknown) {
            if (error instanceof Error) {
                this.logger.error('Error reading config file', error.message);
            } else {
                this.logger.error('Error reading config file', String(error));
            }
            return { profiles: [], activeProfile: null };
        }
    }

    /**
     * Saves the profile configuration to disk
     * @param config - Configuration object to save
     * @throws Error if saving fails
     */
    private saveConfig(config: { profiles: string[], activeProfile: string | null }): void {
        try {
            this.logger.debug(`Saving config: ${JSON.stringify(config)}`);
            fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
        } catch (error: unknown) {
            if (error instanceof Error) {
                this.logger.error('Error saving config file', error.message);
                throw new Error(`Failed to save profile configuration: ${error.message}`);
            }
            throw new Error('Failed to save profile configuration');
        }
    }

    /**
     * Lists all valid profiles
     * Verifies each profile has a valid certificate file
     * Cleans up profiles with missing certificates
     * @returns Array of verified profile names
     */
    async listProfiles(): Promise<string[]> {
        this.logger.debug('Listing profiles');
        const config = this.getConfig();
        // Verify each profile has a corresponding cert file
        const verifiedProfiles = config.profiles.filter(profile => {
            const certPath = path.join(this.cloudflaredDir, `cert_${profile}.pem`);
            const exists = fs.existsSync(certPath);
            this.logger.debug(`Profile ${profile} cert file exists: ${exists}`);
            return exists;
        });
        
        if (verifiedProfiles.length !== config.profiles.length) {
            this.logger.warn('Some profiles were missing cert files, updating config');
            this.saveConfig({
                ...config,
                profiles: verifiedProfiles,
                activeProfile: verifiedProfiles.includes(config.activeProfile || '') ? config.activeProfile : null
            });
        }
        
        return verifiedProfiles;
    }

    /**
     * Gets the currently active profile name
     * @returns Active profile name or null if none active
     */
    async getActiveProfile(): Promise<string | null> {
        const config = this.getConfig();
        return config.activeProfile;
    }

    /**
     * Initiates the Cloudflare login process
     * Opens a terminal for the user to complete authentication
     * Waits for the certificate file to be created
     * @throws Error if login times out or fails
     */
    async loginToCloudflare(): Promise<void> {
        this.logger.info('Starting Cloudflare login process');
        const terminal = vscode.window.createTerminal('Cloudflare Login');
        terminal.show();
        terminal.sendText('cloudflared tunnel login');
        
        // Show a message to the user with instructions
        await vscode.window.showInformationMessage(
            'Please complete the login process in your browser. Click OK once you have logged in.',
            'OK'
        );

        // Wait for cert.pem to appear (check every second for up to 60 seconds)
        for (let i = 0; i < 60; i++) {
            if (await this.isLoggedIn()) {
                this.logger.info('Login successful, cert.pem found');
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.logger.error('Login timed out, no cert.pem found');
        throw new Error('Login timed out. Please try again.');
    }

    /**
     * Creates a new Cloudflare profile
     * 1. Verifies cloudflared is installed
     * 2. Backs up existing certificate if needed
     * 3. Initiates new login for the profile
     * 4. Saves the new certificate and updates configuration
     * 
     * @param profileName - Name of the profile to create
     * @throws Error if profile creation fails
     */
    async createProfile(profileName: string): Promise<void> {
        this.logger.info(`Creating profile: ${profileName}`);
        
        // Check if cloudflared is installed first
        if (!await this.isCloudflaredInstalled()) {
            const message = 'Cloudflared CLI is not installed. Please install it using one of these methods:\n\n' +
                          'macOS:\n' +
                          '  brew install cloudflare/cloudflare/cloudflared\n\n' +
                          'Windows:\n' +
                          '  Using Chocolatey:\n' +
                          '    choco install cloudflared\n' +
                          '  Using Winget:\n' +
                          '    winget install Cloudflare.cloudflared\n\n' +
                          'Linux:\n' +
                          '  Debian/Ubuntu:\n' +
                          '    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared\n' +
                          '    chmod +x cloudflared\n' +
                          '    sudo mv cloudflared /usr/local/bin\n\n' +
                          '  RHEL/Fedora:\n' +
                          '    dnf install cloudflared\n\n' +
                          '  Arch Linux:\n' +
                          '    yay -S cloudflared-bin\n\n' +
                          'After installing, authenticate with:\n' +
                          '  cloudflared tunnel login';
            this.logger.error('Failed to create profile: cloudflared not installed');
            throw new Error(message);
        }

        const config = this.getConfig();
        
        if (config.profiles.includes(profileName)) {
            this.logger.error(`Profile ${profileName} already exists`);
            throw new Error(`Profile '${profileName}' already exists`);
        }

        const certPath = path.join(this.cloudflaredDir, 'cert.pem');
        const profileCertPath = path.join(this.cloudflaredDir, `cert_${profileName}.pem`);

        try {
            // If there's an active profile, back up its cert first
            if (config.activeProfile && fs.existsSync(certPath)) {
                const currentProfilePath = path.join(this.cloudflaredDir, `cert_${config.activeProfile}.pem`);
                this.logger.debug(`Backing up current profile cert: ${certPath} -> ${currentProfilePath}`);
                fs.copyFileSync(certPath, currentProfilePath);
            }

            // Remove the current cert.pem to force a new login
            if (fs.existsSync(certPath)) {
                this.logger.debug('Removing current cert.pem');
                fs.unlinkSync(certPath);
            }

            // Force a new login for the new profile
            await this.loginToCloudflare();

            // After successful login, copy the new cert.pem to the profile's cert file
            if (!fs.existsSync(certPath)) {
                throw new Error('Login failed: cert.pem not created');
            }

            this.logger.debug(`Saving new profile cert: ${certPath} -> ${profileCertPath}`);
            fs.copyFileSync(certPath, profileCertPath);

            // Update config
            config.profiles.push(profileName);
            config.activeProfile = profileName; // Set as active profile
            this.saveConfig(config);

            this.logger.info(`Successfully created and activated profile: ${profileName}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to create profile ${profileName}:`, message);
            throw new Error(`Failed to create profile: ${message}`);
        }
    }

    /**
     * Switches to a different Cloudflare profile
     * 1. Verifies the target profile exists
     * 2. Backs up the current profile's certificate if needed
     * 3. Copies the target profile's certificate to cert.pem
     * 4. Updates the active profile in the configuration
     * 
     * @param profileName - Name of the profile to switch to
     * @throws Error if profile switching fails
     */
    async switchProfile(profileName: string): Promise<void> {
        this.logger.info(`Switching to profile: ${profileName}`);
        const config = this.getConfig();
        
        if (!config.profiles.includes(profileName)) {
            this.logger.error(`Profile ${profileName} does not exist`);
            throw new Error(`Profile '${profileName}' does not exist`);
        }

        const certPath = path.join(this.cloudflaredDir, 'cert.pem');
        const newProfilePath = path.join(this.cloudflaredDir, `cert_${profileName}.pem`);

        try {
            // First verify the target profile's cert exists
            if (!fs.existsSync(newProfilePath)) {
                this.logger.error(`Certificate file not found: ${newProfilePath}`);
                throw new Error(`Certificate file for profile '${profileName}' not found`);
            }

            // Backup current profile's cert if it exists
            if (config.activeProfile) {
                const currentProfilePath = path.join(this.cloudflaredDir, `cert_${config.activeProfile}.pem`);
                if (fs.existsSync(certPath)) {
                    this.logger.debug(`Backing up current profile cert: ${certPath} -> ${currentProfilePath}`);
                    const certContent = fs.readFileSync(certPath);
                    fs.writeFileSync(currentProfilePath, certContent, { mode: 0o600 });
                    fs.unlinkSync(certPath);
                }
            }

            // Copy the new profile's cert to cert.pem
            this.logger.debug(`Activating new profile cert: ${newProfilePath} -> ${certPath}`);
            const newCertContent = fs.readFileSync(newProfilePath);
            fs.writeFileSync(certPath, newCertContent, { mode: 0o600 });

            // Verify the cert.pem exists and is readable
            try {
                fs.accessSync(certPath, fs.constants.R_OK);
                const stats = fs.statSync(certPath);
                if (stats.size === 0) {
                    throw new Error('cert.pem is empty');
                }
            } catch (error) {
                throw new Error(`Failed to verify cert.pem: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Only after successful file operations, update the config
            config.activeProfile = profileName;
            this.saveConfig(config);
            this.logger.info(`Successfully switched to profile ${profileName}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error switching to profile ${profileName}:`, message);
            throw new Error(`Failed to switch profile: ${message}`);
        }
    }

    /**
     * Deletes a Cloudflare profile
     * 1. Verifies the profile exists
     * 2. If the profile is active, switches to another profile if available
     * 3. Deletes the profile's certificate file
     * 4. Updates the configuration
     * 
     * @param profileName - Name of the profile to delete
     * @throws Error if profile deletion fails
     */
    async deleteProfile(profileName: string): Promise<void> {
        this.logger.info(`Deleting profile: ${profileName}`);
        const config = this.getConfig();
        if (!config.profiles.includes(profileName)) {
            this.logger.error(`Profile ${profileName} does not exist`);
            throw new Error(`Profile '${profileName}' does not exist`);
        }

        // If this is the active profile and there are other profiles, switch to another one first
        if (config.activeProfile === profileName && config.profiles.length > 1) {
            const nextProfile = config.profiles.find(p => p !== profileName);
            if (nextProfile) {
                this.logger.info(`Switching to ${nextProfile} before deleting active profile`);
                await this.switchProfile(nextProfile);
            }
        } else if (config.activeProfile === profileName) {
            // This is the only profile, just clear the active profile
            config.activeProfile = null;
            this.saveConfig(config);
        }

        const profilePath = path.join(this.cloudflaredDir, `cert_${profileName}.pem`);
        if (fs.existsSync(profilePath)) {
            this.logger.debug(`Deleting profile cert file: ${profilePath}`);
            fs.unlinkSync(profilePath);
        }

        config.profiles = config.profiles.filter(p => p !== profileName);
        this.saveConfig(config);
        this.logger.info(`Profile ${profileName} deleted successfully`);
    }

    /**
     * Renames a Cloudflare profile
     * 1. Verifies the profile exists
     * 2. Verifies the new name does not already exist
     * 3. Renames the profile's certificate file
     * 4. Updates the configuration
     * 
     * @param oldName - Current name of the profile
     * @param newName - New name for the profile
     * @throws Error if profile renaming fails
     */
    async renameProfile(oldName: string, newName: string): Promise<void> {
        this.logger.info(`Renaming profile from "${oldName}" to "${newName}"`);
        const config = this.getConfig();
        
        if (!config.profiles.includes(oldName)) {
            this.logger.error(`Profile ${oldName} does not exist`);
            throw new Error(`Profile '${oldName}' does not exist`);
        }

        if (config.profiles.includes(newName)) {
            this.logger.error(`Profile ${newName} already exists`);
            throw new Error(`Profile '${newName}' already exists`);
        }

        const oldCertPath = path.join(this.cloudflaredDir, `cert_${oldName}.pem`);
        const newCertPath = path.join(this.cloudflaredDir, `cert_${newName}.pem`);

        try {
            // Verify the old cert exists
            if (!fs.existsSync(oldCertPath)) {
                this.logger.error(`Certificate file not found: ${oldCertPath}`);
                throw new Error(`Certificate file for profile '${oldName}' not found`);
            }

            // Rename the cert file
            fs.renameSync(oldCertPath, newCertPath);

            // Update config
            config.profiles = config.profiles.map(p => p === oldName ? newName : p);
            if (config.activeProfile === oldName) {
                config.activeProfile = newName;
            }
            this.saveConfig(config);

            this.logger.info(`Successfully renamed profile from "${oldName}" to "${newName}"`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to rename profile from "${oldName}" to "${newName}":`, message);
            throw new Error(`Failed to rename profile: ${message}`);
        }
    }

    /**
     * Checks if cloudflared is installed
     * @returns True if cloudflared is installed, false otherwise
     */
    async isCloudflaredInstalled(): Promise<boolean> {
        try {
            await exec('cloudflared --version');
            this.logger.info('Cloudflared is installed');
            return true;
        } catch (error: unknown) {
            if (error instanceof Error) {
                this.logger.error('Cloudflared is not installed', error.message);
            } else {
                this.logger.error('Cloudflared is not installed', String(error));
            }
            return false;
        }
    }

    /**
     * Checks if the user is logged in to Cloudflare
     * @returns True if logged in, false otherwise
     */
    async isLoggedIn(): Promise<boolean> {
        const certPath = path.join(this.cloudflaredDir, 'cert.pem');
        return fs.existsSync(certPath);
    }

    /**
     * Creates a default profile from the existing cert.pem
     * @throws Error if default profile creation fails
     */
    async createDefaultProfile(): Promise<void> {
        this.logger.info('Creating default profile from existing cert.pem');
        const config = this.getConfig();
        const profileName = 'Default Profile';
        
        if (config.profiles.includes(profileName)) {
            this.logger.error(`Profile ${profileName} already exists`);
            throw new Error(`Profile '${profileName}' already exists`);
        }

        const certPath = path.join(this.cloudflaredDir, 'cert.pem');
        const profileCertPath = path.join(this.cloudflaredDir, `cert_${profileName}.pem`);

        try {
            // Copy the existing cert.pem to the profile's cert file
            if (!fs.existsSync(certPath)) {
                throw new Error('No existing cert.pem found');
            }

            this.logger.debug(`Copying existing cert to profile: ${certPath} -> ${profileCertPath}`);
            fs.copyFileSync(certPath, profileCertPath);

            // Update config
            config.profiles.push(profileName);
            config.activeProfile = profileName; // Set as active profile
            this.saveConfig(config);

            this.logger.info(`Successfully created and activated default profile`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to create default profile:`, message);
            throw new Error(`Failed to create default profile: ${message}`);
        }
    }
}
