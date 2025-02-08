/**
 * CloudflareApiService - Service for Cloudflare API Interactions
 * 
 * This service handles all direct API calls to Cloudflare's API endpoints.
 * It manages authentication and provides methods for tunnel operations.
 */

import * as vscode from 'vscode';
import { Logger, LogComponent } from '../utils/logger';
import { ProfileManager } from './profileManager';

interface CloudflareTunnel {
    id: string;
    name: string;
    created_at: string;
    deleted_at?: string;
    account_tag: string;
    connections?: Array<{
        id: string;
        connected_at: string;
        disconnected_at?: string;
        status: string;
        colo_name: string;
        uuid: string;
        is_pending_reconnect: boolean;
        origin_ip: string;
        opened_at: string;
        client_id: string;
        client_version: string;
    }>;
    conns_active_at: string | null;
    conns_inactive_at: string | null;
    tun_type: string;
    metadata: Record<string, any>;
    status: string;
    remote_config: boolean;
}

interface CloudflareAccount {
    id: string;
    name: string;
    type: string;
    settings: {
        enforce_twofactor: boolean;
        api_access_enabled: boolean | null;
        access_approval_expiry: string | null;
        use_account_custom_ns_by_default: boolean;
        default_nameservers: string;
        abuse_contact_email: string | null;
    };
    created_on: string;
}

export class CloudflareApiService {
    private readonly logger: Logger;
    private readonly baseUrl = 'https://api.cloudflare.com/client/v4';
    private accountId: string | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly profileManager: ProfileManager
    ) {
        this.logger = Logger.getInstance();
    }

    /**
     * Gets the API key for the current profile
     */
    private async getApiKey(): Promise<string> {
        const activeProfile = await this.profileManager.getActiveProfile();
        if (!activeProfile) {
            throw new Error('No active profile found. Please create and activate a profile first.');
        }

        const apiKey = await this.profileManager.getProfileApiKey(activeProfile);
        if (!apiKey) {
            throw new Error(`No API key found for profile '${activeProfile}'. Please recreate the profile.`);
        }

        return apiKey;
    }

    /**
     * Gets the account ID for the current profile
     */
    private async getAccountId(): Promise<string> {
        if (this.accountId) {
            return this.accountId;
        }

        const activeProfile = await this.profileManager.getActiveProfile();
        if (!activeProfile) {
            throw new Error('No active profile found');
        }

        // First try to get from profile
        const profileAccountId = await this.profileManager.getProfileAccountId(activeProfile);
        if (profileAccountId) {
            this.accountId = profileAccountId;
            return profileAccountId;
        }

        // If not found, fetch from API
        try {
            const accounts = await this.makeRequest('/accounts') as CloudflareAccount[];
            if (!accounts || accounts.length === 0) {
                throw new Error('No Cloudflare accounts found');
            }

            // Use the first account
            this.accountId = accounts[0].id;
            
            // Store the account ID in the profile
            await this.profileManager.setProfileAccountId(activeProfile, this.accountId);
            
            return this.accountId;
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to get account ID:', error);
            throw new Error('Failed to get Cloudflare account ID. Please check your API key permissions.');
        }
    }

    /**
     * Makes an authenticated request to the Cloudflare API
     */
    private async makeRequest(
        endpoint: string,
        method: string = 'GET',
        body?: any
    ): Promise<any> {
        const apiKey = await this.getApiKey();
        
        const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        };

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined
            });

            const data = await response.json() as {
                success: boolean;
                errors?: Array<{ message: string }>;
                result: any;
            };

            if (!response.ok) {
                throw new Error(data.errors?.[0]?.message || `API request failed: ${response.statusText}`);
            }

            if (!data.success) {
                throw new Error(data.errors?.[0]?.message || 'API request was not successful');
            }

            return data.result;
        } catch (error) {
            this.logger.error(LogComponent.API, `API request failed: ${endpoint}`, error);
            throw error;
        }
    }

    /**
     * Lists all tunnels for the account
     */
    async listTunnels(): Promise<CloudflareTunnel[]> {
        try {
            const accountId = await this.getAccountId();
            const tunnels = await this.makeRequest(`/accounts/${accountId}/tunnels`);
            
            // Filter out deleted tunnels and sort by creation date (newest first)
            const activeTunnels = tunnels
                .filter((tunnel: CloudflareTunnel) => !tunnel.deleted_at)
                .sort((a: CloudflareTunnel, b: CloudflareTunnel) => 
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );

            this.logger.debug(LogComponent.API, `Found ${activeTunnels.length} active tunnels`);
            
            // Map additional status information
            return activeTunnels.map((tunnel: CloudflareTunnel) => ({
                ...tunnel,
                // Ensure connections is always an array
                connections: tunnel.connections || [],
                // Normalize status based on various fields
                status: this.normalizeTunnelStatus(tunnel)
            }));
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to list tunnels:', error);
            throw error;
        }
    }

    /**
     * Normalizes tunnel status based on various fields
     */
    private normalizeTunnelStatus(tunnel: CloudflareTunnel): string {
        // If tunnel has an explicit status, use it
        if (tunnel.status === 'healthy') {
            return 'healthy';
        }

        // If tunnel has active connections, it's running
        if (tunnel.connections && tunnel.connections.length > 0) {
            return 'running';
        }

        // If tunnel has active_at time and no inactive_at time, it's running
        if (tunnel.conns_active_at && !tunnel.conns_inactive_at) {
            return 'running';
        }

        // If tunnel is marked as down, return down
        if (tunnel.status === 'down') {
            return 'down';
        }

        // Default to inactive
        return 'inactive';
    }

    /**
     * Gets detailed information about a specific tunnel
     */
    async getTunnelInfo(tunnelId: string): Promise<CloudflareTunnel> {
        try {
            const accountId = await this.getAccountId();
            const tunnel = await this.makeRequest(`/accounts/${accountId}/tunnels/${tunnelId}`);
            this.logger.debug(LogComponent.API, `Retrieved info for tunnel: ${tunnel.name}`);
            return tunnel;
        } catch (error) {
            this.logger.error(LogComponent.API, `Failed to get tunnel info for ${tunnelId}:`, error);
            throw error;
        }
    }

    /**
     * Creates a new tunnel
     */
    async createTunnel(name: string): Promise<CloudflareTunnel> {
        try {
            const accountId = await this.getAccountId();
            const tunnel = await this.makeRequest(`/accounts/${accountId}/tunnels`, 'POST', { name });
            this.logger.info(LogComponent.API, `Created tunnel: ${name}`);
            return tunnel;
        } catch (error) {
            this.logger.error(LogComponent.API, `Failed to create tunnel ${name}:`, error);
            throw error;
        }
    }

    /**
     * Deletes a tunnel
     */
    async deleteTunnel(tunnelId: string): Promise<void> {
        try {
            const accountId = await this.getAccountId();
            await this.makeRequest(`/accounts/${accountId}/tunnels/${tunnelId}`, 'DELETE');
            this.logger.info(LogComponent.API, `Deleted tunnel: ${tunnelId}`);
        } catch (error) {
            this.logger.error(LogComponent.API, `Failed to delete tunnel ${tunnelId}:`, error);
            throw error;
        }
    }

    /**
     * Gets the token for a tunnel
     */
    async getTunnelToken(tunnelId: string): Promise<string> {
        try {
            const accountId = await this.getAccountId();
            const { token } = await this.makeRequest(`/accounts/${accountId}/tunnels/${tunnelId}/token`);
            return token;
        } catch (error) {
            this.logger.error(LogComponent.API, `Failed to get token for tunnel ${tunnelId}:`, error);
            throw error;
        }
    }

    /**
     * Gets the configurations for a tunnel
     */
    async getTunnelConfigs(tunnelId: string): Promise<any> {
        try {
            const accountId = await this.getAccountId();
            const configs = await this.makeRequest(`/accounts/${accountId}/tunnels/${tunnelId}/configurations`);
            return configs;
        } catch (error) {
            this.logger.error(LogComponent.API, `Failed to get configs for tunnel ${tunnelId}:`, error);
            throw error;
        }
    }

    /**
     * Lists all accounts accessible with the provided API key
     * @param apiKey - The API key to use for the request
     */
    async listAccounts(apiKey: string): Promise<CloudflareAccount[]> {
        try {
            const headers = {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            };

            const response = await fetch(`${this.baseUrl}/accounts`, {
                method: 'GET',
                headers
            });

            const data = await response.json() as {
                success: boolean;
                errors?: Array<{ message: string }>;
                result: CloudflareAccount[];
            };

            if (!response.ok) {
                throw new Error(data.errors?.[0]?.message || `API request failed: ${response.statusText}`);
            }

            if (!data.success) {
                throw new Error(data.errors?.[0]?.message || 'API request was not successful');
            }

            this.logger.debug(LogComponent.API, `Found ${data.result.length} accounts`);
            return data.result;
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to list accounts:', error);
            throw error;
        }
    }
} 