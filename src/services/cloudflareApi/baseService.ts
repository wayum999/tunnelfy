import * as vscode from "vscode";
import { Logger, LogComponent } from "../../utils/logger";
import { ProfileManager } from "../profileManager";
import { CloudflareApiResponse, CloudflareAccount } from "./types";

/** Upper bound on one Cloudflare API request, response body included */
export const CLOUDFLARE_REQUEST_TIMEOUT_MS = 15_000;

/** Page size for list calls; 50 is within every list endpoint's limit */
export const CLOUDFLARE_PAGE_SIZE = 50;

/** Stops a paging loop whose result_info never reaches its last page */
export const CLOUDFLARE_MAX_PAGES = 1_000;

/**
 * Raised when a Cloudflare API request does not complete within its timeout.
 * The message names the operation, never the request headers.
 */
export class CloudflareRequestTimeoutError extends Error {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Cloudflare API request timed out after ${timeoutMs / 1000}s: ${operation}`,
    );
    this.name = "CloudflareRequestTimeoutError";
  }
}

/**
 * Base service class for Cloudflare API interactions
 * Handles core functionality like authentication and request handling
 */
export class BaseCloudflareService {
  protected readonly logger: Logger;
  protected readonly baseUrl = "https://api.cloudflare.com/client/v4";
  protected accountId: string | null = null;
  protected apiKey: string | null = null;
  protected requestTimeoutMs = CLOUDFLARE_REQUEST_TIMEOUT_MS;

  constructor(
    protected readonly context: vscode.ExtensionContext,
    protected readonly profileManager: ProfileManager,
  ) {
    this.logger = Logger.getInstance();
  }

  /**
   * Sets the API key for Cloudflare authentication
   * @param apiKey Cloudflare API key
   */
  async setApiKey(apiKey: string): Promise<void> {
    this.apiKey = apiKey;
  }

  /**
   * Retrieves the API key for the current profile
   * @returns API key string
   * @throws Error if no active profile or API key not found
   * @protected
   */
  protected async getApiKey(): Promise<string> {
    // Don't use cached API key, always get from current profile
    const activeProfile = await this.profileManager.getActiveProfile();
    if (!activeProfile) {
      throw new Error("No active profile found");
    }

    const apiKey = await this.profileManager.getProfileApiKey(activeProfile);
    if (!apiKey) {
      throw new Error("No API key found in active profile");
    }

    return apiKey;
  }

  /**
   * Gets the account ID for the current profile
   * @returns Account ID string
   * @throws Error if no active profile or account ID not found
   * @protected
   */
  protected async getAccountId(): Promise<string> {
    // Don't use cached account ID, always get from current profile
    const activeProfile = await this.profileManager.getActiveProfile();
    if (!activeProfile) {
      throw new Error("No active profile found");
    }

    try {
      // First try to get from secure storage
      const profileAccountId =
        await this.profileManager.getProfileAccountId(activeProfile);
      if (profileAccountId) {
        // Validate the account ID format
        if (!this.isValidAccountId(profileAccountId)) {
          this.logger.warn(
            LogComponent.API,
            "Invalid account ID format in storage, refetching from API",
          );
          return await this.fetchAndStoreAccountId(activeProfile);
        }
        return profileAccountId;
      }

      return await this.fetchAndStoreAccountId(activeProfile);
    } catch (error) {
      this.logger.error(LogComponent.API, "Failed to get account ID:", error);
      throw new Error(
        "Failed to get Cloudflare account ID. Please check your API key permissions.",
      );
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
   * Makes an authenticated request to the Cloudflare API
   * Handles authentication, error handling, and response parsing
   * @param endpoint API endpoint to call
   * @param method HTTP method to use
   * @param body Optional request body
   * @returns Parsed API response
   * @throws Error if request fails or response is invalid
   * @protected
   */
  protected async makeRequest<T>(
    endpoint: string,
    method: string = "GET",
    body?: any,
  ): Promise<T> {
    const data = await this.sendRequest<T>(endpoint, method, body);
    return data.result;
  }

  /**
   * Reads every page of a Cloudflare list endpoint
   * Follows result_info until the last page, so no item past the first page is lost
   * @param endpoint API endpoint to list, without paging parameters
   * @param params Extra query parameters sent with every page
   * @returns Items from all pages, in API order
   * @throws Error if any page fails
   * @protected
   */
  protected async makePaginatedRequest<T>(
    endpoint: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= CLOUDFLARE_MAX_PAGES; page++) {
      const query = new URLSearchParams({
        ...params,
        page: String(page),
        per_page: String(CLOUDFLARE_PAGE_SIZE),
      });
      const separator = endpoint.includes("?") ? "&" : "?";
      const data = await this.sendRequest<T[]>(
        `${endpoint}${separator}${query.toString()}`,
      );
      const pageItems = Array.isArray(data.result) ? data.result : [];
      items.push(...pageItems);

      const totalPages = data.result_info?.total_pages;
      const isLastPage =
        typeof totalPages === "number"
          ? page >= totalPages
          : pageItems.length < CLOUDFLARE_PAGE_SIZE;
      if (isLastPage || pageItems.length === 0) {
        return items;
      }
    }
    throw new Error(
      `Cloudflare API listing did not end after ${CLOUDFLARE_MAX_PAGES} pages: ${endpoint}`,
    );
  }

  /**
   * Sends one authenticated, time-bounded request and returns the whole response envelope
   * @private
   */
  private async sendRequest<T>(
    endpoint: string,
    method: string = "GET",
    body?: any,
  ): Promise<CloudflareApiResponse<T>> {
    // Use temporary API key if set, otherwise get from active profile
    const apiKey = this.apiKey || (await this.getApiKey());

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        // If we get a non-JSON response, try to get the text for better error reporting
        const text = await response.text();
        this.logger.error(
          LogComponent.API,
          `Received non-JSON response: ${text.substring(0, 200)}...`,
        );
        throw new Error(
          "Invalid API response: Expected JSON but received HTML. Your API token may have expired.",
        );
      }

      const data = (await response.json()) as CloudflareApiResponse<T>;

      if (!response.ok) {
        const errorMsg =
          data.errors?.[0]?.message ||
          `API request failed: ${response.statusText}`;
        this.logger.error(LogComponent.API, `API error: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      if (!data.success) {
        const errorMsg =
          data.errors?.[0]?.message || "API request was not successful";
        this.logger.error(LogComponent.API, `API error: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      return data;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        const timeoutError = new CloudflareRequestTimeoutError(
          `${method} ${endpoint.split("?")[0]}`,
          this.requestTimeoutMs,
        );
        this.logger.error(LogComponent.API, timeoutError.message);
        throw timeoutError;
      }

      // If this is our custom error about HTML response, suggest token refresh
      if (
        error instanceof Error &&
        error.message.includes("Expected JSON but received HTML")
      ) {
        this.logger.error(
          LogComponent.API,
          "Authentication error - please try refreshing your API token",
        );
        throw new Error(
          "Authentication failed. Please try updating your API token in the profile settings.",
        );
      }

      this.logger.error(
        LogComponent.API,
        `API request failed: ${endpoint}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Fetches account ID from API and stores it securely
   * @param profileName The profile to store the account ID for
   * @returns The fetched account ID
   * @private
   */
  private async fetchAndStoreAccountId(profileName: string): Promise<string> {
    const accounts =
      await this.makePaginatedRequest<CloudflareAccount>("/accounts");
    if (!accounts || accounts.length === 0) {
      throw new Error("No Cloudflare accounts found");
    }

    const accountId = accounts[0].id;

    // Validate the account ID before storing
    if (!this.isValidAccountId(accountId)) {
      throw new Error("Invalid account ID received from Cloudflare API");
    }

    // Store the account ID securely
    try {
      await this.profileManager.setProfileAccountId(profileName, accountId);
    } catch (error) {
      this.logger.error(
        LogComponent.API,
        "Failed to store account ID securely:",
        error,
      );
      throw new Error("Failed to securely store account ID");
    }

    return accountId;
  }
}
