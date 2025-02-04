export declare class ProfileManager {
    private readonly cloudflaredDir;
    private readonly configFile;
    private readonly logger;
    constructor();
    private ensureConfigExists;
    private getConfig;
    private saveConfig;
    listProfiles(): Promise<string[]>;
    getActiveProfile(): Promise<string | null>;
    loginToCloudflare(): Promise<void>;
    createProfile(profileName: string): Promise<void>;
    switchProfile(profileName: string): Promise<void>;
    deleteProfile(profileName: string): Promise<void>;
    isCloudflaredInstalled(): Promise<boolean>;
    isLoggedIn(): Promise<boolean>;
}
