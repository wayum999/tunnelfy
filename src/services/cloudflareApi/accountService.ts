import { BaseCloudflareService } from "./baseService";
import { CloudflareAccount } from "./types";
import { LogComponent } from "../../utils/logger";

/**
 * Service for managing Cloudflare accounts
 * Handles account-specific API operations
 */
export class AccountService extends BaseCloudflareService {
  /**
   * Lists all accounts accessible with the current API key
   * @returns Array of account information
   * @throws Error if account listing fails
   */
  async listAccounts(): Promise<CloudflareAccount[]> {
    try {
      return await this.makeRequest<CloudflareAccount[]>("/accounts");
    } catch (error) {
      this.logger.error(LogComponent.API, "Failed to list accounts:", error);
      throw error;
    }
  }
}
