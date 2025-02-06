"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileManager = void 0;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const util_1 = require("util");
const logger_1 = require("../utils/logger");
const exec = (0, util_1.promisify)(cp.exec);
class ProfileManager {
    /**
     * Initializes the ProfileManager
     * Sets up necessary directories and configuration files
     */
    constructor() {
        this.cloudflaredDir = path.join(os.homedir(), '.cloudflared');
        this.configFile = path.join(this.cloudflaredDir, 'profiles.json');
        this.logger = logger_1.Logger.getInstance();
        this.ensureConfigExists();
    }
    /**
     * Ensures the profile configuration file exists
     * Creates default configuration if none exists
     */
    ensureConfigExists() {
        this.logger.debug(logger_1.LogComponent.PROFILE, `Ensuring config exists at: ${this.configFile}`);
        if (!fs.existsSync(this.cloudflaredDir)) {
            this.logger.debug(logger_1.LogComponent.PROFILE, 'Creating cloudflared directory');
            fs.mkdirSync(this.cloudflaredDir, { recursive: true });
        }
        if (!fs.existsSync(this.configFile)) {
            this.logger.debug(logger_1.LogComponent.PROFILE, 'Creating initial profiles config file');
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
    getConfig() {
        try {
            this.logger.debug(logger_1.LogComponent.PROFILE, 'Reading profiles config file');
            if (!fs.existsSync(this.configFile)) {
                this.logger.debug(logger_1.LogComponent.PROFILE, 'Config file not found, creating default');
                this.ensureConfigExists();
                return { profiles: [], activeProfile: null };
            }
            const content = fs.readFileSync(this.configFile, 'utf8');
            const config = JSON.parse(content);
            this.logger.debug(logger_1.LogComponent.PROFILE, `Found profiles: ${JSON.stringify(config.profiles)}`);
            this.logger.debug(logger_1.LogComponent.PROFILE, `Active profile: ${config.activeProfile}`);
            return config;
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.error(logger_1.LogComponent.PROFILE, 'Error reading config file', error.message);
            }
            else {
                this.logger.error(logger_1.LogComponent.PROFILE, 'Error reading config file', String(error));
            }
            return { profiles: [], activeProfile: null };
        }
    }
    /**
     * Saves the profile configuration to disk
     * @param config - Configuration object to save
     * @throws Error if saving fails
     */
    saveConfig(config) {
        try {
            this.logger.debug(logger_1.LogComponent.PROFILE, `Saving config: ${JSON.stringify(config)}`);
            fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.error(logger_1.LogComponent.PROFILE, 'Error saving config file', error.message);
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
    async listProfiles() {
        this.logger.debug(logger_1.LogComponent.PROFILE, 'Listing profiles');
        const config = this.getConfig();
        // Verify each profile has a corresponding cert file
        const verifiedProfiles = config.profiles.filter(profile => {
            const certPath = path.join(this.cloudflaredDir, `cert_${profile}.pem`);
            const exists = fs.existsSync(certPath);
            this.logger.debug(logger_1.LogComponent.PROFILE, `Profile ${profile} cert file exists: ${exists}`);
            return exists;
        });
        if (verifiedProfiles.length !== config.profiles.length) {
            this.logger.warn(logger_1.LogComponent.PROFILE, 'Some profiles were missing cert files, updating config');
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
    async getActiveProfile() {
        const config = this.getConfig();
        return config.activeProfile;
    }
    /**
     * Initiates the Cloudflare login process
     * Opens a terminal for the user to complete authentication
     * Waits for the certificate file to be created
     * @throws Error if login times out or fails
     */
    async loginToCloudflare() {
        this.logger.info(logger_1.LogComponent.PROFILE, 'Starting Cloudflare login process');
        const terminal = vscode.window.createTerminal('Cloudflare Login');
        terminal.show();
        terminal.sendText('cloudflared tunnel login');
        // Show a message to the user with instructions
        await vscode.window.showInformationMessage('Please complete the login process in your browser. Click OK once you have logged in.', 'OK');
        // Wait for cert.pem to appear (check every second for up to 60 seconds)
        for (let i = 0; i < 60; i++) {
            if (await this.isLoggedIn()) {
                this.logger.info(logger_1.LogComponent.PROFILE, 'Login successful, cert.pem found');
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        this.logger.error(logger_1.LogComponent.PROFILE, 'Login timed out, no cert.pem found');
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
    async createProfile(profileName) {
        this.logger.info(logger_1.LogComponent.PROFILE, `Creating profile: ${profileName}`);
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
            this.logger.error(logger_1.LogComponent.PROFILE, 'Failed to create profile: cloudflared not installed');
            throw new Error(message);
        }
        const config = this.getConfig();
        if (config.profiles.includes(profileName)) {
            this.logger.error(logger_1.LogComponent.PROFILE, `Profile ${profileName} already exists`);
            throw new Error(`Profile '${profileName}' already exists`);
        }
        const certPath = path.join(this.cloudflaredDir, 'cert.pem');
        const profileCertPath = path.join(this.cloudflaredDir, `cert_${profileName}.pem`);
        try {
            // If there's an active profile, back up its cert first
            if (config.activeProfile && fs.existsSync(certPath)) {
                const currentProfilePath = path.join(this.cloudflaredDir, `cert_${config.activeProfile}.pem`);
                this.logger.debug(logger_1.LogComponent.PROFILE, `Backing up current profile cert: ${certPath} -> ${currentProfilePath}`);
                fs.copyFileSync(certPath, currentProfilePath);
            }
            // Remove the current cert.pem to force a new login
            if (fs.existsSync(certPath)) {
                this.logger.debug(logger_1.LogComponent.PROFILE, 'Removing current cert.pem');
                fs.unlinkSync(certPath);
            }
            // Force a new login for the new profile
            await this.loginToCloudflare();
            // After successful login, copy the new cert.pem to the profile's cert file
            if (!fs.existsSync(certPath)) {
                throw new Error('Login failed: cert.pem not created');
            }
            this.logger.debug(logger_1.LogComponent.PROFILE, `Saving new profile cert: ${certPath} -> ${profileCertPath}`);
            fs.copyFileSync(certPath, profileCertPath);
            // Update config
            config.profiles.push(profileName);
            config.activeProfile = profileName; // Set as active profile
            this.saveConfig(config);
            this.logger.info(logger_1.LogComponent.PROFILE, `Successfully created and activated profile: ${profileName}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(logger_1.LogComponent.PROFILE, `Failed to create profile ${profileName}:`, message);
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
    async switchProfile(profileName) {
        this.logger.info(logger_1.LogComponent.PROFILE, `Switching to profile: ${profileName}`);
        const config = this.getConfig();
        if (!config.profiles.includes(profileName)) {
            this.logger.error(logger_1.LogComponent.PROFILE, `Profile ${profileName} does not exist`);
            throw new Error(`Profile '${profileName}' does not exist`);
        }
        const certPath = path.join(this.cloudflaredDir, 'cert.pem');
        const newProfilePath = path.join(this.cloudflaredDir, `cert_${profileName}.pem`);
        try {
            // First verify the target profile's cert exists
            if (!fs.existsSync(newProfilePath)) {
                this.logger.error(logger_1.LogComponent.PROFILE, `Certificate file not found: ${newProfilePath}`);
                throw new Error(`Certificate file for profile '${profileName}' not found`);
            }
            // Backup current profile's cert if it exists
            if (config.activeProfile) {
                const currentProfilePath = path.join(this.cloudflaredDir, `cert_${config.activeProfile}.pem`);
                if (fs.existsSync(certPath)) {
                    this.logger.debug(logger_1.LogComponent.PROFILE, `Backing up current profile cert: ${certPath} -> ${currentProfilePath}`);
                    const certContent = fs.readFileSync(certPath);
                    fs.writeFileSync(currentProfilePath, certContent, { mode: 0o600 });
                    fs.unlinkSync(certPath);
                }
            }
            // Copy the new profile's cert to cert.pem
            this.logger.debug(logger_1.LogComponent.PROFILE, `Activating new profile cert: ${newProfilePath} -> ${certPath}`);
            const newCertContent = fs.readFileSync(newProfilePath);
            fs.writeFileSync(certPath, newCertContent, { mode: 0o600 });
            // Verify the cert.pem exists and is readable
            try {
                fs.accessSync(certPath, fs.constants.R_OK);
                const stats = fs.statSync(certPath);
                if (stats.size === 0) {
                    throw new Error('cert.pem is empty');
                }
            }
            catch (error) {
                throw new Error(`Failed to verify cert.pem: ${error instanceof Error ? error.message : String(error)}`);
            }
            // Only after successful file operations, update the config
            config.activeProfile = profileName;
            this.saveConfig(config);
            this.logger.info(logger_1.LogComponent.PROFILE, `Successfully switched to profile ${profileName}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(logger_1.LogComponent.PROFILE, `Error switching to profile ${profileName}:`, message);
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
    async deleteProfile(profileName) {
        this.logger.info(logger_1.LogComponent.PROFILE, `Deleting profile: ${profileName}`);
        const config = this.getConfig();
        if (!config.profiles.includes(profileName)) {
            this.logger.error(logger_1.LogComponent.PROFILE, `Profile ${profileName} does not exist`);
            throw new Error(`Profile '${profileName}' does not exist`);
        }
        // If this is the active profile and there are other profiles, switch to another one first
        if (config.activeProfile === profileName && config.profiles.length > 1) {
            const nextProfile = config.profiles.find(p => p !== profileName);
            if (nextProfile) {
                this.logger.info(logger_1.LogComponent.PROFILE, `Switching to ${nextProfile} before deleting active profile`);
                await this.switchProfile(nextProfile);
            }
        }
        else if (config.activeProfile === profileName) {
            // This is the only profile, just clear the active profile
            config.activeProfile = null;
            this.saveConfig(config);
        }
        const profilePath = path.join(this.cloudflaredDir, `cert_${profileName}.pem`);
        if (fs.existsSync(profilePath)) {
            this.logger.debug(logger_1.LogComponent.PROFILE, `Deleting profile cert file: ${profilePath}`);
            fs.unlinkSync(profilePath);
        }
        config.profiles = config.profiles.filter(p => p !== profileName);
        this.saveConfig(config);
        this.logger.info(logger_1.LogComponent.PROFILE, `Profile ${profileName} deleted successfully`);
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
    async renameProfile(oldName, newName) {
        this.logger.info(logger_1.LogComponent.PROFILE, `Renaming profile from "${oldName}" to "${newName}"`);
        const config = this.getConfig();
        if (!config.profiles.includes(oldName)) {
            this.logger.error(logger_1.LogComponent.PROFILE, `Profile ${oldName} does not exist`);
            throw new Error(`Profile '${oldName}' does not exist`);
        }
        if (config.profiles.includes(newName)) {
            this.logger.error(logger_1.LogComponent.PROFILE, `Profile ${newName} already exists`);
            throw new Error(`Profile '${newName}' already exists`);
        }
        const oldCertPath = path.join(this.cloudflaredDir, `cert_${oldName}.pem`);
        const newCertPath = path.join(this.cloudflaredDir, `cert_${newName}.pem`);
        try {
            // Verify the old cert exists
            if (!fs.existsSync(oldCertPath)) {
                this.logger.error(logger_1.LogComponent.PROFILE, `Certificate file not found: ${oldCertPath}`);
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
            this.logger.info(logger_1.LogComponent.PROFILE, `Successfully renamed profile from "${oldName}" to "${newName}"`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(logger_1.LogComponent.PROFILE, `Failed to rename profile from "${oldName}" to "${newName}":`, message);
            throw new Error(`Failed to rename profile: ${message}`);
        }
    }
    /**
     * Checks if cloudflared is installed
     * @returns True if cloudflared is installed, false otherwise
     */
    async isCloudflaredInstalled() {
        try {
            await exec('cloudflared --version');
            this.logger.info(logger_1.LogComponent.PROFILE, 'Cloudflared is installed');
            return true;
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.error(logger_1.LogComponent.PROFILE, 'Cloudflared is not installed', error.message);
            }
            else {
                this.logger.error(logger_1.LogComponent.PROFILE, 'Cloudflared is not installed', String(error));
            }
            return false;
        }
    }
    /**
     * Checks if the user is logged in to Cloudflare
     * @returns True if logged in, false otherwise
     */
    async isLoggedIn() {
        const certPath = path.join(this.cloudflaredDir, 'cert.pem');
        return fs.existsSync(certPath);
    }
    /**
     * Creates a default profile from the existing cert.pem
     * @throws Error if default profile creation fails
     */
    async createDefaultProfile() {
        this.logger.info(logger_1.LogComponent.PROFILE, 'Creating default profile from existing cert.pem');
        const config = this.getConfig();
        const profileName = 'Default Profile';
        if (config.profiles.includes(profileName)) {
            this.logger.error(logger_1.LogComponent.PROFILE, `Profile ${profileName} already exists`);
            throw new Error(`Profile '${profileName}' already exists`);
        }
        const certPath = path.join(this.cloudflaredDir, 'cert.pem');
        const profileCertPath = path.join(this.cloudflaredDir, `cert_${profileName}.pem`);
        try {
            // Copy the existing cert.pem to the profile's cert file
            if (!fs.existsSync(certPath)) {
                throw new Error('No existing cert.pem found');
            }
            this.logger.debug(logger_1.LogComponent.PROFILE, `Copying existing cert to profile: ${certPath} -> ${profileCertPath}`);
            fs.copyFileSync(certPath, profileCertPath);
            // Update config
            config.profiles.push(profileName);
            config.activeProfile = profileName; // Set as active profile
            this.saveConfig(config);
            this.logger.info(logger_1.LogComponent.PROFILE, `Successfully created and activated default profile`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(logger_1.LogComponent.PROFILE, `Failed to create default profile: ${message}`);
            throw new Error(`Failed to create default profile: ${message}`);
        }
    }
}
exports.ProfileManager = ProfileManager;
//# sourceMappingURL=profileManager.js.map