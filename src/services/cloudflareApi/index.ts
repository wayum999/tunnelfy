import * as vscode from 'vscode';
import { ProfileManager } from '../profileManager';
import { AccountService } from './accountService';
import { TunnelService } from './tunnelService';
import { DnsService } from './dnsService';
import { Logger, LogComponent } from '../../utils/logger';

// Export all types
export * from './types';

/**
 * Main Cloudflare API service that combines all sub-services
 * This maintains backward compatibility with the original CloudflareApiService
 */
export class CloudflareApiService {
    private readonly accountService: AccountService;
    private readonly tunnelService: TunnelService;
    private readonly dnsService: DnsService;
    private readonly logger: Logger;

    constructor(
        context: vscode.ExtensionContext,
        profileManager: ProfileManager
    ) {
        this.logger = Logger.getInstance();
        this.accountService = new AccountService(context, profileManager);
        this.tunnelService = new TunnelService(context, profileManager);
        this.dnsService = new DnsService(context, profileManager);
    }

    // API Key Management
    async setApiKey(apiKey: string): Promise<void> {
        await this.accountService.setApiKey(apiKey);
        await this.tunnelService.setApiKey(apiKey);
        await this.dnsService.setApiKey(apiKey);
    }

    // Account Operations
    async listAccounts() {
        return this.accountService.listAccounts();
    }

    // Tunnel Operations
    async listTunnels() {
        return this.tunnelService.listTunnels();
    }

    async getTunnelInfo(tunnelId: string) {
        return this.tunnelService.getTunnelInfo(tunnelId);
    }

    async createTunnel(name: string) {
        return this.tunnelService.createTunnel(name);
    }

    async deleteTunnel(tunnelId: string) {
        return this.tunnelService.deleteTunnel(tunnelId);
    }

    async getTunnelToken(tunnelId: string) {
        return this.tunnelService.getTunnelToken(tunnelId);
    }

    async getTunnelConfigs(tunnelId: string) {
        return this.tunnelService.getTunnelConfigs(tunnelId);
    }

    // DNS Operations
    async listZones() {
        return this.dnsService.listZones();
    }

    async listDnsRecords(zoneId: string) {
        return this.dnsService.listDnsRecords(zoneId);
    }

    async createCnameRecord(zoneId: string, name: string, tunnelId: string) {
        return this.dnsService.createCnameRecord(zoneId, name, tunnelId);
    }

    async updateCnameRecord(zoneId: string, recordId: string, tunnelId: string) {
        return this.dnsService.updateCnameRecord(zoneId, recordId, tunnelId);
    }

    async deleteDnsRecord(zoneId: string, recordId: string) {
        return this.dnsService.deleteDnsRecord(zoneId, recordId);
    }

    async checkCnameConflicts(zoneId: string, recordName: string, tunnelId: string) {
        return this.dnsService.checkCnameConflicts(zoneId, recordName, tunnelId);
    }
} 