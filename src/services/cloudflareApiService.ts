/**
 * CloudflareApiService - Service for Cloudflare API Interactions
 * 
 * This service handles all direct API calls to Cloudflare's API endpoints.
 * It manages authentication and provides methods for tunnel operations.
 * 
 * Key responsibilities:
 * 1. Managing API authentication
 * 2. Handling API requests and responses
 * 3. Error handling and logging
 * 4. Account and zone management
 * 5. DNS record operations
 * 
 * Security features:
 * - Token-based authentication
 * - Secure token storage
 * - Error handling for expired tokens
 * - Account validation
 */

import * as vscode from 'vscode';
import { Logger, LogComponent } from '../utils/logger';
import { ProfileManager } from './profileManager';

/**
 * Interface representing a Cloudflare tunnel's data structure
 * Matches the API response format from Cloudflare
 */
export interface CloudflareTunnel {
    /** Unique identifier for the tunnel */
    id: string;
    /** User-defined name for the tunnel */
    name: string;
    /** Timestamp when the tunnel was created */
    created_at: string;
    /** Timestamp when the tunnel was deleted (if applicable) */
    deleted_at?: string;
    /** Account identifier tag */
    account_tag: string;
    /** Array of active connections for this tunnel */
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
    /** Timestamp of last active connection */
    conns_active_at: string | null;
    /** Timestamp of last inactive connection */
    conns_inactive_at: string | null;
    /** Type of tunnel */
    tun_type: string;
    /** Additional metadata */
    metadata: Record<string, any>;
    /** Current tunnel status */
    status: string;
    /** Whether the tunnel uses remote configuration */
    remote_config: boolean;
}

/**
 * Interface representing a Cloudflare account
 * Contains account details and settings
 */
interface CloudflareAccount {
    /** Unique identifier for the account */
    id: string;
    /** Account name */
    name: string;
    /** Account type */
    type: string;
    /** Account settings */
    settings: {
        /** Whether two-factor authentication is required */
        enforce_twofactor: boolean;
        /** Whether API access is enabled */
        api_access_enabled: boolean | null;
        /** Expiry time for access approval */
        access_approval_expiry: string | null;
        /** Whether to use account custom nameservers by default */
        use_account_custom_ns_by_default: boolean;
        /** Default nameservers */
        default_nameservers: string;
        /** Email for abuse reports */
        abuse_contact_email: string | null;
    };
    /** Account creation timestamp */
    created_on: string;
}

export class CloudflareApiService {
    private readonly logger: Logger;
    private readonly baseUrl = 'https://api.cloudflare.com/client/v4';
    private accountId: string | null = null;
    private apiKey: string | null = null;

    /**
     * Creates a new instance of CloudflareApiService
     * @param context VS Code extension context for storage access
     * @param profileManager Profile manager for handling authentication
     */
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly profileManager: ProfileManager
    ) {
        this.logger = Logger.getInstance();
    }

    /**
     * Sets the API key for Cloudflare authentication
     * @param apiKey Cloudflare API key
     * @throws Error if API key is invalid
     */
    async setApiKey(apiKey: string): Promise<void> {
        this.apiKey = apiKey;
    }

    /**
     * Retrieves the API key for the current profile
     * @returns API key string
     * @throws Error if no active profile or API key not found
     * @private
     */
    private async getApiKey(): Promise<string> {
        // Don't use cached API key, always get from current profile
        const activeProfile = await this.profileManager.getActiveProfile();
        if (!activeProfile) {
            throw new Error('No active profile found');
        }

        const apiKey = await this.profileManager.getProfileApiKey(activeProfile);
        if (!apiKey) {
            throw new Error('No API key found in active profile');
        }

        return apiKey;
    }

    /**
     * Gets the account ID for the current profile
     * @returns Account ID string
     * @throws Error if no active profile or account ID not found
     * @private
     */
    private async getAccountId(): Promise<string> {
        // Don't use cached account ID, always get from current profile
        const activeProfile = await this.profileManager.getActiveProfile();
        if (!activeProfile) {
            throw new Error('No active profile found');
        }

        try {
            // First try to get from secure storage
            const profileAccountId = await this.profileManager.getProfileAccountId(activeProfile);
            if (profileAccountId) {
                // Validate the account ID format
                if (!this.isValidAccountId(profileAccountId)) {
                    this.logger.warn(LogComponent.API, 'Invalid account ID format in storage, refetching from API');
                    return await this.fetchAndStoreAccountId(activeProfile);
                }
                return profileAccountId;
            }

            return await this.fetchAndStoreAccountId(activeProfile);
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to get account ID:', error);
            throw new Error('Failed to get Cloudflare account ID. Please check your API key permissions.');
        }
    }

    /**
     * Validates the format of a Cloudflare account ID
     * @param accountId The account ID to validate
     * @returns boolean indicating if the account ID is valid
     * @private
     */
    private isValidAccountId(accountId: string): boolean {
        // Cloudflare account IDs are 32-character hexadecimal strings
        const accountIdRegex = /^[a-f0-9]{32}$/i;
        return accountIdRegex.test(accountId);
    }

    /**
     * Fetches account ID from API and stores it securely
     * @param profileName The profile to store the account ID for
     * @returns The fetched account ID
     * @private
     */
    private async fetchAndStoreAccountId(profileName: string): Promise<string> {
        const accounts = await this.makeRequest('/accounts') as CloudflareAccount[];
        if (!accounts || accounts.length === 0) {
            throw new Error('No Cloudflare accounts found');
        }

        const accountId = accounts[0].id;
        
        // Validate the account ID before storing
        if (!this.isValidAccountId(accountId)) {
            throw new Error('Invalid account ID received from Cloudflare API');
        }

        // Store the account ID securely
        try {
            await this.profileManager.setProfileAccountId(profileName, accountId);
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to store account ID securely:', error);
            throw new Error('Failed to securely store account ID');
        }
        
        return accountId;
    }

    /**
     * Makes an authenticated request to the Cloudflare API
     * Handles authentication, error handling, and response parsing
     * @param endpoint API endpoint to call
     * @param method HTTP method to use
     * @param body Optional request body
     * @returns Parsed API response
     * @throws Error if request fails or response is invalid
     * @private
     */
    private async makeRequest(
        endpoint: string,
        method: string = 'GET',
        body?: any
    ): Promise<any> {
        // Use temporary API key if set, otherwise get from active profile
        const apiKey = this.apiKey || await this.getApiKey();
        
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
     * Filters out deleted tunnels and sorts by name
     * @returns Array of active tunnels
     * @throws Error if listing fails
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
     * @param tunnel The tunnel to check status for
     * @returns Normalized status string
     * @private
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
     * @param tunnelId ID of the tunnel to get info for
     * @returns Tunnel information
     * @throws Error if tunnel info cannot be retrieved
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
     * @param name Name for the new tunnel
     * @returns Created tunnel information
     * @throws Error if tunnel creation fails
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
     * @param tunnelId ID of the tunnel to delete
     * @throws Error if deletion fails
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
     * @param tunnelId ID of the tunnel
     * @returns Tunnel token
     * @throws Error if token cannot be retrieved
     */
    async getTunnelToken(tunnelId: string): Promise<string> {
        try {
            const accountId = await this.getAccountId();
            const response = await this.makeRequest(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
            // The API returns the token as a string
            return response.toString();
        } catch (error) {
            this.logger.error(LogComponent.API, `Failed to get token for tunnel ${tunnelId}:`, error);
            throw error;
        }
    }

    /**
     * Gets the configurations for a tunnel
     * @param tunnelId ID of the tunnel
     * @returns Tunnel configurations
     * @throws Error if configurations cannot be retrieved
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
     * Lists all accounts accessible with the current API key
     * @returns Array of account information
     * @throws Error if account listing fails
     */
    async listAccounts(): Promise<CloudflareAccount[]> {
        try {
            return await this.makeRequest('/accounts');
        } catch (error) {
            this.logger.error(LogComponent.API, 'Failed to list accounts:', error);
            throw error;
        }
    }

    /**
     * Lists all zones (domains) for the account
     * @returns Array of zone information
     * @throws Error if zone listing fails
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
     * @param zoneId ID of the zone to list records for
     * @returns Array of DNS record information
     * @throws Error if record listing fails
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
     * @param zoneId ID of the zone to create record in
     * @param name Name for the CNAME record
     * @param tunnelId ID of the tunnel to point to
     * @returns Created record information
     * @throws Error if record creation fails
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
     * @param zoneId ID of the zone containing the record
     * @param recordId ID of the record to update
     * @param tunnelId ID of the tunnel to point to
     * @returns Updated record information
     * @throws Error if record update fails
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
     * @param zoneId ID of the zone containing the record
     * @param recordId ID of the record to delete
     * @throws Error if record deletion fails
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
     * @param zoneId ID of the zone to check
     * @param recordName Name of the record to check
     * @param tunnelId ID of the tunnel
     * @returns Object containing any conflicts found
     * @throws Error if conflict check fails
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