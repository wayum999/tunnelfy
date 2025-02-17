import { BaseCloudflareService } from './baseService';
import { DnsRecord, Zone, CnameConflictResult } from './types';
import { LogComponent } from '../../utils/logger';

/**
 * Service for managing Cloudflare DNS records
 * Handles DNS-specific API operations
 */
export class DnsService extends BaseCloudflareService {
    /**
     * Lists all zones (domains) for the account
     * @returns Array of zone information
     * @throws Error if zone listing fails
     */
    async listZones(): Promise<Zone[]> {
        try {
            const zones = await this.makeRequest<any[]>('/zones');
            return zones.map(zone => ({
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
    async listDnsRecords(zoneId: string): Promise<DnsRecord[]> {
        try {
            const records = await this.makeRequest<any[]>(`/zones/${zoneId}/dns_records`);
            return records.map(record => ({
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
            const record = await this.makeRequest<any>(
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
            const record = await this.makeRequest<any>(
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
    async checkCnameConflicts(zoneId: string, recordName: string, tunnelId: string): Promise<CnameConflictResult> {
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