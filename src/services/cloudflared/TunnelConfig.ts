import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogComponent } from '../../utils/logger';

export interface TunnelConfigData {
    accountId: string;
    tunnelId: string;
    tunnelName: string;
    credentials: {
        accountTag: string;
        tunnelSecret: string;
    };
    ingress: Array<{
        hostname?: string;
        service: string;
        path?: string;
    }>;
    warpRouting?: {
        enabled: boolean;
    };
}

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

    private ensureConfigDirectory(): void {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
    }

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

    private getTunnelConfigPath(tunnelId: string): string {
        return path.join(this.configDir, `${tunnelId}.json`);
    }

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