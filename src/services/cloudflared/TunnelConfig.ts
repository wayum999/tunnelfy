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
    /** Credentials used for tunnel authentication */
    credentials: {
        /** Account tag from Cloudflare */
        accountTag: string;
        /** Secret token for tunnel authentication */
        tunnelSecret: string;
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
        try {
            await fs.promises.writeFile(
                configPath,
                JSON.stringify(config, null, 2),
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
            return JSON.parse(configData) as TunnelConfigData;
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
        if (!config.credentials.accountTag || !config.credentials.tunnelSecret) {
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