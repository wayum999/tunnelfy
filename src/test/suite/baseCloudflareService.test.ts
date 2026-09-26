import * as assert from "assert";
import * as vscode from "vscode";
import {
  BaseCloudflareService,
  CLOUDFLARE_PAGE_SIZE,
  CloudflareRequestTimeoutError,
} from "../../services/cloudflareApi/baseService";
import { TunnelService } from "../../services/cloudflareApi/tunnelService";
import { DnsService } from "../../services/cloudflareApi/dnsService";
import { ProfileManager } from "../../services/profileManager";
import { TestExtensionContext } from "./testUtils";

// Create a test implementation of BaseCloudflareService to access protected methods
class TestBaseCloudflareService extends BaseCloudflareService {
  public async testGetApiKey(): Promise<string> {
    return this.getApiKey();
  }

  public async testGetAccountId(): Promise<string> {
    return this.getAccountId();
  }

  public async testMakeRequest<T>(
    endpoint: string,
    method: string = "GET",
    body?: any,
  ): Promise<T> {
    return this.makeRequest(endpoint, method, body);
  }

  public async testMakePaginatedRequest<T>(
    endpoint: string,
    params?: Record<string, string>,
  ): Promise<T[]> {
    return this.makePaginatedRequest<T>(endpoint, params);
  }

  public setRequestTimeoutMs(timeoutMs: number): void {
    this.requestTimeoutMs = timeoutMs;
  }
}

/** Answers a list call with the page the request URL asks for */
function pagedFetch(
  pages: unknown[][],
  seenUrls: string[],
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    seenUrls.push(url.toString());
    const page = Number(url.searchParams.get("page") ?? "1");
    return new Response(
      JSON.stringify({
        success: true,
        result: pages[page - 1] ?? [],
        result_info: {
          page,
          per_page: CLOUDFLARE_PAGE_SIZE,
          total_pages: pages.length,
          total_count: pages.flat().length,
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

suite("BaseCloudflareService Test Suite", () => {
  let service: TestBaseCloudflareService;
  let context: vscode.ExtensionContext;
  let profileManager: ProfileManager;

  const validAccountId = "a".repeat(32);
  const validApiKey = "test-api-key";
  const testProfileName = "test-profile";

  setup(async () => {
    context = new TestExtensionContext();
    profileManager = new ProfileManager(context);
    service = new TestBaseCloudflareService(context, profileManager);

    // Set up a test profile
    await profileManager.createProfile(
      testProfileName,
      validApiKey,
      validAccountId,
    );
    await profileManager.setActiveProfile(testProfileName);
  });

  teardown(async () => {
    try {
      // Clean up test profile if it exists
      const profiles = profileManager.listProfiles();
      if (profiles.includes(testProfileName)) {
        await profileManager.deleteProfile(testProfileName);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test("should set and use API key", async () => {
    const testKey = "temporary-test-key";
    await service.setApiKey(testKey);

    // Mock the fetch call
    global.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      assert.ok(init?.headers);
      const headers = init.headers as Record<string, string>;
      assert.strictEqual(headers["Authorization"], `Bearer ${testKey}`);
      return new Response(JSON.stringify({ success: true, result: {} }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    // Make a test request
    await service.testMakeRequest("/test-endpoint");
  });

  test("should handle missing API key", async () => {
    // Delete the active profile and create a new one without an API key
    await profileManager.deleteProfile(testProfileName);
    await profileManager.createProfile(
      testProfileName,
      validApiKey,
      validAccountId,
    );
    await profileManager.setActiveProfile(testProfileName);

    // Mock the API key to be empty in the profile manager
    const originalGetProfileApiKey =
      profileManager.getProfileApiKey.bind(profileManager);
    profileManager.getProfileApiKey = async () => "";

    await assert.rejects(
      async () => await service.testGetApiKey(),
      /No API key found in active profile/,
    );

    // Restore original method
    profileManager.getProfileApiKey = originalGetProfileApiKey;
  });

  test("should handle missing active profile", async () => {
    // Delete all profiles to ensure no active profile
    const profiles = profileManager.listProfiles();
    for (const profile of profiles) {
      await profileManager.deleteProfile(profile);
    }

    await assert.rejects(
      async () => await service.testGetApiKey(),
      /No active profile found/,
    );
  });

  test("should validate account ID format", async () => {
    // Test with valid account ID
    const accountId = await service.testGetAccountId();
    assert.strictEqual(accountId, validAccountId);

    // Delete the profile and create a new one to test invalid account ID
    await profileManager.deleteProfile(testProfileName);
    await profileManager.createProfile(
      testProfileName,
      validApiKey,
      validAccountId,
    );
    await profileManager.setActiveProfile(testProfileName);

    // Mock the profile manager to return an invalid account ID
    const originalGetProfileAccountId =
      profileManager.getProfileAccountId.bind(profileManager);
    profileManager.getProfileAccountId = async () => "invalid-id";

    // Mock the fetch call for account refetch
    global.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      return new Response(
        JSON.stringify({
          success: true,
          result: [{ id: validAccountId }],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const newAccountId = await service.testGetAccountId();
    assert.strictEqual(newAccountId, validAccountId);

    // Restore original method
    profileManager.getProfileAccountId = originalGetProfileAccountId;
  });

  test("should handle API errors", async () => {
    // Mock a failed API response
    global.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: "API Error" }],
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => await service.testMakeRequest("/test-endpoint"),
      /API Error/,
    );
  });

  test("should handle non-JSON responses", async () => {
    // Mock an HTML response (like when token is invalid)
    global.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      return new Response("<html><body>Unauthorized</body></html>", {
        status: 401,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;

    await assert.rejects(
      async () => await service.testMakeRequest("/test-endpoint"),
      /Authentication failed. Please try updating your API token in the profile settings./,
    );
  });

  test("should handle network errors", async () => {
    // Mock a network error
    global.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      throw new Error("Network error");
    }) as typeof fetch;

    await assert.rejects(
      async () => await service.testMakeRequest("/test-endpoint"),
      /Network error/,
    );
  });

  test("should handle empty accounts list", async () => {
    // Mock empty accounts response
    global.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      return new Response(
        JSON.stringify({
          success: true,
          result: [],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    // Mock the profile manager to return no account ID
    const originalGetProfileAccountId =
      profileManager.getProfileAccountId.bind(profileManager);
    profileManager.getProfileAccountId = async () => null;

    await assert.rejects(
      async () => await service.testGetAccountId(),
      /Failed to get Cloudflare account ID. Please check your API key permissions./,
    );

    // Restore original method
    profileManager.getProfileAccountId = originalGetProfileAccountId;
  });

  suite("TUNNEL-84 paging, filtering and timeouts", () => {
    let originalFetch: typeof fetch;

    setup(() => {
      originalFetch = global.fetch;
    });

    teardown(() => {
      global.fetch = originalFetch;
    });

    test("a multi-page list returns the items of every page", async () => {
      const seenUrls: string[] = [];
      global.fetch = pagedFetch(
        [[{ id: "a" }, { id: "b" }], [{ id: "c" }], [{ id: "d" }]],
        seenUrls,
      );

      const items = await service.testMakePaginatedRequest<{ id: string }>(
        "/zones",
      );

      assert.deepStrictEqual(
        items.map((item) => item.id),
        ["a", "b", "c", "d"],
      );
      assert.strictEqual(seenUrls.length, 3, "should request exactly 3 pages");
      assert.strictEqual(
        new URL(seenUrls[2]).searchParams.get("per_page"),
        String(CLOUDFLARE_PAGE_SIZE),
      );
    });

    test("tunnel, zone and DNS record lists read past the first page", async () => {
      const seenUrls: string[] = [];
      const tunnel = (id: string) => ({ id, name: id, remote_config: false });
      global.fetch = pagedFetch([[tunnel("t1")], [tunnel("t2")]], seenUrls);

      const tunnels = await new TunnelService(
        context,
        profileManager,
      ).listTunnels();
      const dns = new DnsService(context, profileManager);
      const zones = await dns.listZones();
      const records = await dns.listDnsRecords("zone-id");

      assert.deepStrictEqual(tunnels.map((t) => t.id), ["t1", "t2"]);
      assert.deepStrictEqual(zones.map((z) => z.id), ["t1", "t2"]);
      assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2"]);
    });

    test("the tunnel list asks the API for is_deleted=false", async () => {
      const seenUrls: string[] = [];
      global.fetch = pagedFetch([[]], seenUrls);

      await new TunnelService(context, profileManager).listTunnels();

      assert.strictEqual(seenUrls.length, 1);
      const url = new URL(seenUrls[0]);
      assert.ok(url.pathname.endsWith(`/accounts/${validAccountId}/tunnels`));
      assert.strictEqual(url.searchParams.get("is_deleted"), "false");
    });

    test("a request that exceeds the timeout rejects with a named error", async () => {
      service.setRequestTimeoutMs(20);
      let sawSignal = false;
      // Never answers; only an abort signal can end it
      global.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            return;
          }
          sawSignal = true;
          signal.addEventListener("abort", () => reject(signal.reason));
        })) as typeof fetch;

      await assert.rejects(
        service.testMakeRequest("/zones/abc/dns_records?name=x"),
        (error: unknown) => {
          assert.ok(error instanceof CloudflareRequestTimeoutError);
          assert.strictEqual(error.name, "CloudflareRequestTimeoutError");
          assert.strictEqual(error.operation, "GET /zones/abc/dns_records");
          assert.match(error.message, /timed out after 0\.02s: GET \/zones\/abc\/dns_records$/);
          assert.ok(!error.message.includes(validApiKey), "API key in error");
          return true;
        },
      );
      assert.ok(sawSignal, "fetch was not given an abort signal");
    });
  });

  test("should make POST request with body", async () => {
    const testBody = { test: "data" };

    // Mock the fetch call
    global.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      assert.strictEqual(init?.method, "POST");
      assert.strictEqual(init?.body, JSON.stringify(testBody));
      return new Response(JSON.stringify({ success: true, result: {} }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await service.testMakeRequest("/test-endpoint", "POST", testBody);
  });
});
