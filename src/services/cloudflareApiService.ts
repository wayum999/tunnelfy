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

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                // If we get a non-JSON response, try to get the text for better error reporting
                const text = await response.text();
                this.logger.error(LogComponent.API, `Received non-JSON response: ${text.substring(0, 200)}...`);
                throw new Error('Invalid API response: Expected JSON but received HTML. Your API token may have expired.');
            }

            const data = await response.json() as {
                success: boolean;
                errors?: Array<{ message: string }>;
                result: any;
            };

            if (!response.ok) {
                const errorMsg = data.errors?.[0]?.message || `API request failed: ${response.statusText}`;
                this.logger.error(LogComponent.API, `API error: ${errorMsg}`);
                throw new Error(errorMsg);
            }

            if (!data.success) {
                const errorMsg = data.errors?.[0]?.message || 'API request was not successful';
                this.logger.error(LogComponent.API, `API error: ${errorMsg}`);
                throw new Error(errorMsg);
            }

            return data.result;
        } catch (error) {
            // If this is our custom error about HTML response, suggest token refresh
            if (error instanceof Error && error.message.includes('Expected JSON but received HTML')) {
                this.logger.error(LogComponent.API, 'Authentication error - please try refreshing your API token');
                throw new Error('Authentication failed. Please try updating your API token in the profile settings.');
            }
            
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
            
            // Filter out deleted tunnels and sort by name
            const activeTunnels = tunnels
                .filter((tunnel: CloudflareTunnel) => !tunnel.deleted_at)
                .sort((a: CloudflareTunnel, b: CloudflareTunnel) => 
                    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
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
            this.logger.info(LogComponent.API, `Created tunnel: ${name} (${tunnel.id})`);
            return {
                ...tunnel,
                connections: [],
                status: 'inactive'
            };
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
            await this.makeRequest(`/accounts/${accountId}/cfd_tunnel/${tunnelId}`, 'DELETE');
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
            const token = await this.makeRequest(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
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

    /**
     * Lists all zones (domains) for the account
     */
    async listZones(): Promise<Array<{ id: string; name: string }>> {
        try {
            const zones = await this.makeRequest('/zones');
            return zones.map((zone: any) => ({
                id: zone.id,
                name: zone.name
            }));
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to list zones:', error);
            throw error;
        }
    }

    /**
     * Lists all DNS records for a zone
     */
    async listDnsRecords(zoneId: string): Promise<Array<{ id: string; name: string; type: string; content: string }>> {
        try {
            const records = await this.makeRequest(`/zones/${zoneId}/dns_records`);
            return records.map((record: any) => ({
                id: record.id,
                name: record.name,
                type: record.type,
                content: record.content
            }));
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to list DNS records:', error);
            throw error;
        }
    }

    /**
     * Creates a CNAME record for a tunnel
     */
    async createCnameRecord(zoneId: string, name: string, tunnelId: string): Promise<{ id: string; name: string }> {
        try {
            const record = await this.makeRequest(
                `/zones/${zoneId}/dns_records`,
                'POST',
                {
                    type: 'CNAME',
                    name: name,
                    content: `${tunnelId}.cfargotunnel.com`,
                    proxied: true,
                    ttl: 1
                }
            );
            return {
                id: record.id,
                name: record.name
            };
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to create CNAME record:', error);
            throw error;
        }
    }

    /**
     * Updates a CNAME record to point to a tunnel
     */
    async updateCnameRecord(zoneId: string, recordId: string, tunnelId: string): Promise<{ id: string; name: string }> {
        try {
            const record = await this.makeRequest(
                `/zones/${zoneId}/dns_records/${recordId}`,
                'PATCH',
                {
                    type: 'CNAME',
                    content: `${tunnelId}.cfargotunnel.com`,
                    proxied: true,
                    ttl: 1
                }
            );
            return {
                id: record.id,
                name: record.name
            };
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to update CNAME record:', error);
            throw error;
        }
    }

    /**
     * Deletes a DNS record
     */
    async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
        try {
            await this.makeRequest(`/zones/${zoneId}/dns_records/${recordId}`, 'DELETE');
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to delete DNS record:', error);
            throw error;
        }
    }

    /**
     * Checks for CNAME conflicts with a tunnel
     * @returns Object containing any conflicts found
     */
    async checkCnameConflicts(zoneId: string, recordName: string, tunnelId: string): Promise<{
        isPointingElsewhere: boolean;
        existingRecord?: { id: string; content: string };
        tunnelInUse?: { recordId: string; recordName: string };
    }> {
        try {
            // Get all DNS records for the zone
            const records = await this.listDnsRecords(zoneId);
            
            // Check if the selected CNAME is pointing elsewhere
            const selectedRecord = records.find(r => r.name === recordName && r.type === 'CNAME');
            if (selectedRecord) {
                const tunnelDomain = `${tunnelId}.cfargotunnel.com`;
                if (selectedRecord.content !== tunnelDomain) {
                    return {
                        isPointingElsewhere: true,
                        existingRecord: {
                            id: selectedRecord.id,
                            content: selectedRecord.content
                        }
                    };
                }
            }

            // Check if another CNAME is already using this tunnel
            const tunnelCname = records.find(r => 
                r.type === 'CNAME' && 
                r.content === `${tunnelId}.cfargotunnel.com` &&
                r.name !== recordName
            );

            if (tunnelCname) {
                return {
                    isPointingElsewhere: false,
                    tunnelInUse: {
                        recordId: tunnelCname.id,
                        recordName: tunnelCname.name
                    }
                };
            }

            return { isPointingElsewhere: false };
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to check CNAME conflicts:', error);
            throw error;
        }
    }
} 