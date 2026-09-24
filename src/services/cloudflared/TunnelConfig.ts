import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogComponent } from '../../utils/logger';

/**
 * Interface defining the structure of a tunnel configuration
 * This matches Cloudflare's tunnel configuration format
 */
export interface TunnelConfigData {
    /** The Cloudflare account ID associated with the tunnel */
    accountId: string;
    /** Unique identifier for the tunnel */
    tunnelId: string;
    /** User-friendly name for the tunnel */
    tunnelName: string;
    /**
     * Non-secret tunnel identity. The tunnel token is deliberately NOT stored here:
     * cloudflared never reads this file, and the token is fetched from the API when needed.
     */
    credentials: {
        /** Account tag from Cloudflare */
        accountTag: string;
    };
    /** Array of ingress rules defining how traffic is routed */
    ingress: Array<{
        /** Optional hostname for the ingress rule */
        hostname?: string;
        /** Service specification (e.g., 'http://localhost:8080') */
        service: string;
        /** Optional path for routing */
        path?: string;
    }>;
    /** Optional WARP routing configuration */
    warpRouting?: {
        enabled: boolean;
    };
}

/**
 * TunnelConfig - Manages Cloudflare Tunnel Configurations
 * 
 * This service is responsible for:
 * 1. Storing and managing tunnel configurations locally
 * 2. Validating configuration data
 * 3. Providing CRUD operations for tunnel configs
 * 4. Ensuring configuration directory structure
 * 
 * Configurations are stored in:
 * - Base directory: .tunnelfy/configs/
 * - Each tunnel has its own JSON file named by its ID
 */
export class TunnelConfig {
    private readonly configDir: string;

    constructor(
        private context: vscode.ExtensionContext,
        private logger: Logger,
        private workspaceDir: string
    ) {
        this.configDir = path.join(this.workspaceDir, '.tunnelfy', 'configs');
        this.ensureConfigDirectory();
        this.scrubStoredSecrets();
    }

    /**
     * Removes a legacy `credentials.tunnelSecret` from a parsed config.
     * @returns true if a secret was present and removed
     */
    private static stripSecret(config: any): boolean {
        if (config?.credentials && typeof config.credentials === 'object' && 'tunnelSecret' in config.credentials) {
            delete config.credentials.tunnelSecret;
            return true;
        }
        return false;
    }

    /**
     * Migration: earlier versions wrote the tunnel token into every config file.
     * Rewrites each stored config without it, once per activation.
     */
    private scrubStoredSecrets(): void {
        let files: string[];
        try {
            files = fs.readdirSync(this.configDir).filter(file => file.endsWith('.json'));
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to list tunnel configs for token migration: ${error}`);
            return;
        }
        for (const file of files) {
            const filePath = path.join(this.configDir, file);
            try {
                const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (TunnelConfig.stripSecret(config)) {
                    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
                    this.logger.info(LogComponent.TUNNEL, `Removed stored tunnel token from config ${file}`);
                }
            } catch (error) {
                this.logger.error(LogComponent.TUNNEL, `Failed to migrate tunnel config ${file}: ${error}`);
            }
        }
    }

    /**
     * Creates the configuration directory if it doesn't exist
     * @private
     */
    private ensureConfigDirectory(): void {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
    }

    /**
     * Saves a tunnel configuration to disk
     * @param tunnelId The ID of the tunnel
     * @param config The configuration data to save
     * @throws Error if saving fails
     */
    async saveTunnelConfig(tunnelId: string, config: TunnelConfigData): Promise<void> {
        const configPath = this.getTunnelConfigPath(tunnelId);
        // Never persist a token, whatever the caller handed us.
        const sanitized = { ...config, credentials: { ...config.credentials } };
        TunnelConfig.stripSecret(sanitized);
        try {
            await fs.promises.writeFile(
                configPath,
                JSON.stringify(sanitized, null, 2),
                'utf8'
            );
            this.logger.info(LogComponent.TUNNEL, `Saved config for tunnel ${tunnelId}`);
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to save tunnel config: ${error}`);
            throw error;
        }
    }

    /**
     * Loads a tunnel configuration from disk
     * @param tunnelId The ID of the tunnel
     * @returns The tunnel configuration or null if not found
     */
    async loadTunnelConfig(tunnelId: string): Promise<TunnelConfigData | null> {
        const configPath = this.getTunnelConfigPath(tunnelId);
        try {
            const configData = await fs.promises.readFile(configPath, 'utf8');
            const config = JSON.parse(configData);
            if (TunnelConfig.stripSecret(config)) {
                try {
                    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
                    this.logger.info(LogComponent.TUNNEL, `Removed stored tunnel token from config for tunnel ${tunnelId}`);
                } catch (writeError) {
                    this.logger.error(LogComponent.TUNNEL, `Failed to remove stored tunnel token for tunnel ${tunnelId}: ${writeError}`);
                }
            }
            return config as TunnelConfigData;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.logger.error(LogComponent.TUNNEL, `Failed to load tunnel config: ${error}`);
            }
            return null;
        }
    }

    /**
     * Deletes a tunnel configuration from disk
     * @param tunnelId The ID of the tunnel to delete
     * @throws Error if deletion fails (except for non-existent files)
     */
    async deleteTunnelConfig(tunnelId: string): Promise<void> {
        const configPath = this.getTunnelConfigPath(tunnelId);
        try {
            await fs.promises.unlink(configPath);
            this.logger.info(LogComponent.TUNNEL, `Deleted config for tunnel ${tunnelId}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.logger.error(LogComponent.TUNNEL, `Failed to delete tunnel config: ${error}`);
                throw error;
            }
        }
    }

    /**
     * Lists all tunnel configurations in the config directory
     * @returns Array of tunnel IDs
     */
    async listTunnelConfigs(): Promise<string[]> {
        try {
            const files = await fs.promises.readdir(this.configDir);
            return files
                .filter(file => file.endsWith('.json'))
                .map(file => path.basename(file, '.json'));
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to list tunnel configs: ${error}`);
            return [];
        }
    }

    /**
     * Gets the full path for a tunnel's config file
     * @param tunnelId The ID of the tunnel
     * @returns The full path to the config file
     * @private
     */
    private getTunnelConfigPath(tunnelId: string): string {
        return path.join(this.configDir, `${tunnelId}.json`);
    }

    /**
     * Updates specific fields in a tunnel's configuration
     * @param tunnelId The ID of the tunnel to update
     * @param updates Partial configuration updates to apply
     * @throws Error if the tunnel config doesn't exist or update fails
     */
    async updateTunnelConfig(tunnelId: string, updates: Partial<TunnelConfigData>): Promise<void> {
        const currentConfig = await this.loadTunnelConfig(tunnelId);
        if (!currentConfig) {
            throw new Error(`No configuration found for tunnel ${tunnelId}`);
        }

        const updatedConfig = {
            ...currentConfig,
            ...updates,
            // Preserve nested objects that might be partially updated
            ingress: updates.ingress || currentConfig.ingress,
            credentials: updates.credentials || currentConfig.credentials,
            warpRouting: updates.warpRouting || currentConfig.warpRouting
        };

        await this.saveTunnelConfig(tunnelId, updatedConfig);
    }

    /**
     * Validates a tunnel configuration
     * @param config The configuration to validate
     * @returns true if valid, false otherwise
     */
    async validateConfig(config: TunnelConfigData): Promise<boolean> {
        // Basic validation of required fields
        const requiredFields = ['accountId', 'tunnelId', 'tunnelName', 'credentials', 'ingress'];
        const missingFields = requiredFields.filter(field => !(field in config));

        if (missingFields.length > 0) {
            this.logger.error(
                LogComponent.TUNNEL,
                `Invalid tunnel config: Missing required fields: ${missingFields.join(', ')}`
            );
            return false;
        }

        // Validate credentials
        if (!config.credentials.accountTag) {
            this.logger.error(
                LogComponent.TUNNEL,
                'Invalid tunnel config: Missing credential fields'
            );
            return false;
        }

        // Validate ingress rules
        if (!Array.isArray(config.ingress) || config.ingress.length === 0) {
            this.logger.error(
                LogComponent.TUNNEL,
                'Invalid tunnel config: Ingress rules must be a non-empty array'
            );
            return false;
        }

        for (const rule of config.ingress) {
            if (!rule.service) {
                this.logger.error(
                    LogComponent.TUNNEL,
                    'Invalid tunnel config: Each ingress rule must specify a service'
                );
                return false;
            }
        }

        return true;
    }
} 