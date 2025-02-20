import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  TunnelConfig,
  TunnelConfigData,
} from "../../services/cloudflared/TunnelConfig";
import { Logger } from "../../utils/logger";

suite("TunnelConfig Test Suite", () => {
  let tunnelConfig: TunnelConfig;
  let testWorkspaceDir: string;
  let configDir: string;

  const mockContext = {
    extensionPath: __dirname,
    subscriptions: [],
    workspaceState: {
      get: () => undefined,
      update: () => Promise.resolve(),
    },
    globalState: {
      get: () => undefined,
      update: () => Promise.resolve(),
    },
    extensionUri: vscode.Uri.file(__dirname),
    asAbsolutePath: (relativePath: string) =>
      path.join(__dirname, relativePath),
    storagePath: path.join(__dirname, "storage"),
    globalStoragePath: path.join(__dirname, "globalStorage"),
    logPath: path.join(__dirname, "logs"),
  } as unknown as vscode.ExtensionContext;

  const mockLogger = {
    info: () => {},
    error: () => {},
    debug: () => {},
    warn: () => {},
  } as unknown as Logger;

  const sampleConfig: TunnelConfigData = {
    accountId: "test-account",
    tunnelId: "test-tunnel",
    tunnelName: "Test Tunnel",
    credentials: {
      accountTag: "test-tag",
      tunnelSecret: "test-secret",
    },
    ingress: [
      {
        hostname: "test.example.com",
        service: "http://localhost:8080",
      },
    ],
  };

  setup(() => {
    testWorkspaceDir = path.join(__dirname, "test-workspace");
    configDir = path.join(testWorkspaceDir, ".tunnelfy", "configs");
    tunnelConfig = new TunnelConfig(mockContext, mockLogger, testWorkspaceDir);

    // Create test directory structure
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  });

  teardown(() => {
    // Clean up test directory
    if (fs.existsSync(testWorkspaceDir)) {
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    }
  });

  test("saveTunnelConfig should save config to file", async () => {
    await tunnelConfig.saveTunnelConfig("test-tunnel", sampleConfig);
    const configPath = path.join(configDir, "test-tunnel.json");
    assert.strictEqual(fs.existsSync(configPath), true);

    const savedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.deepStrictEqual(savedConfig, sampleConfig);
  });

  test("loadTunnelConfig should load config from file", async () => {
    await tunnelConfig.saveTunnelConfig("test-tunnel", sampleConfig);
    const loadedConfig = await tunnelConfig.loadTunnelConfig("test-tunnel");
    assert.deepStrictEqual(loadedConfig, sampleConfig);
  });

  test("loadTunnelConfig should return null for non-existent config", async () => {
    const loadedConfig = await tunnelConfig.loadTunnelConfig("non-existent");
    assert.strictEqual(loadedConfig, null);
  });

  test("deleteTunnelConfig should remove config file", async () => {
    await tunnelConfig.saveTunnelConfig("test-tunnel", sampleConfig);
    const configPath = path.join(configDir, "test-tunnel.json");
    assert.strictEqual(fs.existsSync(configPath), true);

    await tunnelConfig.deleteTunnelConfig("test-tunnel");
    assert.strictEqual(fs.existsSync(configPath), false);
  });

  test("listTunnelConfigs should return list of config files", async () => {
    await tunnelConfig.saveTunnelConfig("tunnel1", sampleConfig);
    await tunnelConfig.saveTunnelConfig("tunnel2", sampleConfig);

    const configs = await tunnelConfig.listTunnelConfigs();
    assert.deepStrictEqual(configs.sort(), ["tunnel1", "tunnel2"]);
  });

  test("updateTunnelConfig should partially update config", async () => {
    await tunnelConfig.saveTunnelConfig("test-tunnel", sampleConfig);

    const updates = {
      tunnelName: "Updated Tunnel",
      ingress: [
        {
          hostname: "updated.example.com",
          service: "http://localhost:9090",
        },
      ],
    };

    await tunnelConfig.updateTunnelConfig("test-tunnel", updates);
    const updatedConfig = await tunnelConfig.loadTunnelConfig("test-tunnel");

    assert.strictEqual(updatedConfig?.tunnelName, "Updated Tunnel");
    assert.deepStrictEqual(updatedConfig?.ingress, updates.ingress);
    assert.strictEqual(updatedConfig?.accountId, sampleConfig.accountId);
  });

  test("validateConfig should validate required fields", async () => {
    const validConfig = { ...sampleConfig };
    assert.strictEqual(await tunnelConfig.validateConfig(validConfig), true);

    const invalidConfig = { ...sampleConfig } as any;
    delete invalidConfig.accountId;
    assert.strictEqual(await tunnelConfig.validateConfig(invalidConfig), false);
  });

  test("validateConfig should validate ingress rules", async () => {
    const validConfig = { ...sampleConfig };
    assert.strictEqual(await tunnelConfig.validateConfig(validConfig), true);

    const invalidConfig = {
      ...sampleConfig,
      ingress: [
        {
          hostname: "test.example.com",
          service: "", // Empty service should be invalid
        },
      ],
    };
    assert.strictEqual(await tunnelConfig.validateConfig(invalidConfig), false);
  });
});
