import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SystemServiceGenerator } from "../../services/systemServiceGenerator";
import { CloudflareApiService } from "../../services/cloudflareApi";
import { TunnelManager } from "../../services/cloudflared";
import { Logger, LogComponent } from "../../utils/logger";

suite("SystemServiceGenerator Test Suite", () => {
  let systemServiceGenerator: SystemServiceGenerator;
  let mockTunnelManager: TunnelManager;
  let mockApiService: CloudflareApiService;
  let testWorkspaceFolder: string;

  const testTunnelId = "test-tunnel-id";
  const testTunnelName = "test-tunnel";
  const testPort = 8080;
  const testToken = "test-token";

  setup(async () => {
    // Create a mock workspace folder
    testWorkspaceFolder = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "test-workspace"
    );
    if (!fs.existsSync(testWorkspaceFolder)) {
      fs.mkdirSync(testWorkspaceFolder, { recursive: true });
    }

    // Mock the workspace folders
    const mockWorkspaceFolder = {
      uri: vscode.Uri.file(testWorkspaceFolder),
      name: "test-workspace",
      index: 0,
    };
    const mockWorkspaceFolders = [mockWorkspaceFolder];
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      value: mockWorkspaceFolders,
      writable: true,
      configurable: true,
    });

    // Mock the API service
    mockApiService = {
      getTunnelToken: async () => testToken,
    } as any;

    // Mock the tunnel manager
    mockTunnelManager = {
      runningTunnels: new Map(),
      _onTunnelEvent: new vscode.EventEmitter(),
      onTunnelEvent: new vscode.EventEmitter().event,
      tunnelLogger: {} as any,
    } as any;

    systemServiceGenerator = new SystemServiceGenerator(
      mockTunnelManager,
      mockApiService
    );
  });

  teardown(() => {
    // Clean up test workspace folder
    if (fs.existsSync(testWorkspaceFolder)) {
      fs.rmSync(testWorkspaceFolder, { recursive: true, force: true });
    }
  });

  test("should generate system service file with correct content", async () => {
    // Mock the showInformationMessage to simulate user clicking "Generate"
    const mockShowInfo = async () => ({ title: "Generate" });
    const originalShowInfo = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = mockShowInfo as any;

    try {
      const result = await systemServiceGenerator.generateServiceFile(
        testTunnelId,
        testTunnelName,
        testPort
      );

      assert.strictEqual(result.type, "workspace");
      assert.ok(result.servicePath);
      assert.ok(result.envPath);

      // Verify files exist
      assert.strictEqual(fs.existsSync(result.servicePath!), true);
      assert.strictEqual(fs.existsSync(result.envPath!), true);

      // Read and verify service file content
      const serviceContent = fs.readFileSync(result.servicePath!, "utf8");

      // Verify essential systemd service elements
      assert.strictEqual(serviceContent.includes("[Unit]"), true);
      assert.strictEqual(serviceContent.includes("[Service]"), true);
      assert.strictEqual(serviceContent.includes("[Install]"), true);
      assert.strictEqual(
        serviceContent.includes(`Description=Cloudflare Tunnel - ${testTunnelName}`),
        true
      );
      assert.strictEqual(
        serviceContent.includes("Type=simple"),
        true
      );
      assert.strictEqual(
        serviceContent.includes("User=cloudflared"),
        true
      );

      // Verify command configuration
      const commandLine = `ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:${testPort} run`;
      assert.strictEqual(serviceContent.includes(commandLine), true);

      // Verify security hardening options
      assert.strictEqual(serviceContent.includes("ProtectSystem=strict"), true);
      assert.strictEqual(serviceContent.includes("ProtectHome=true"), true);
      assert.strictEqual(serviceContent.includes("PrivateTmp=true"), true);
      assert.strictEqual(serviceContent.includes("NoNewPrivileges=true"), true);

      // Read and verify env file content
      const envContent = fs.readFileSync(result.envPath!, "utf8");
      assert.strictEqual(envContent.trim(), `TUNNEL_TOKEN=${testToken}`);
    } finally {
      vscode.window.showInformationMessage = originalShowInfo;
    }
  });

  test("should handle errors gracefully", async () => {
    // Mock the showInformationMessage to simulate user clicking "Generate"
    const mockShowInfo = async () => ({ title: "Generate" });
    const originalShowInfo = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = mockShowInfo as any;

    try {
      // Mock API service to simulate token retrieval failure
      mockApiService.getTunnelToken = async () => {
        throw new Error("Could not get tunnel token");
      };

      await assert.rejects(
        () =>
          systemServiceGenerator.generateServiceFile(
            testTunnelId,
            testTunnelName,
            testPort
          ),
        (error) => {
          assert.ok(error instanceof Error);
          assert.ok(error.name === "ServiceFileGenerationError");
          assert.ok(error.cause instanceof Error);
          assert.ok((error.cause as Error).message === "Could not get tunnel token");
          return true;
        }
      );
    } finally {
      vscode.window.showInformationMessage = originalShowInfo;
    }
  });

  test("should show confirmation dialog and generate files when confirmed", async () => {
    // Mock the showInformationMessage to simulate user clicking "Generate"
    const mockShowInfo = async () => ({ title: "Generate" });
    const originalShowInfo = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = mockShowInfo as any;

    try {
      const result = await systemServiceGenerator.generateServiceFile(
        testTunnelId,
        testTunnelName,
        testPort
      );

      // Verify files were generated
      assert.strictEqual(result.type, "workspace");
      assert.ok(fs.existsSync(result.servicePath!));
      assert.ok(fs.existsSync(result.envPath!));
    } finally {
      vscode.window.showInformationMessage = originalShowInfo;
    }
  });

  test("should not generate files when confirmation is cancelled", async () => {
    // Mock the showInformationMessage to simulate user clicking "Cancel"
    const mockShowInfo = async () => ({ title: "Cancel" });
    const originalShowInfo = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = mockShowInfo as any;

    try {
      await assert.rejects(
        () =>
          systemServiceGenerator.generateServiceFile(
            testTunnelId,
            testTunnelName,
            testPort
          ),
        /User cancelled service file generation/
      );
    } finally {
      vscode.window.showInformationMessage = originalShowInfo;
    }
  });

  test("should show overwrite confirmation when files exist", async () => {
    // Mock the showInformationMessage to simulate user clicking "Generate"
    const mockShowInfo = async () => ({ title: "Generate" });
    const originalShowInfo = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = mockShowInfo as any;

    // Mock the showWarningMessage for overwrite confirmation
    const mockShowWarning = async () => ({ title: "Overwrite" });
    const originalShowWarning = vscode.window.showWarningMessage;
    vscode.window.showWarningMessage = mockShowWarning as any;

    try {
      // Create files first
      const firstResult = await systemServiceGenerator.generateServiceFile(
        testTunnelId,
        testTunnelName,
        testPort
      );

      // Try to generate again
      const secondResult = await systemServiceGenerator.generateServiceFile(
        testTunnelId,
        testTunnelName,
        testPort
      );

      // Verify files were generated both times
      assert.strictEqual(secondResult.type, "workspace");
      assert.ok(fs.existsSync(secondResult.servicePath!));
      assert.ok(fs.existsSync(secondResult.envPath!));
    } finally {
      vscode.window.showInformationMessage = originalShowInfo;
      vscode.window.showWarningMessage = originalShowWarning;
    }
  });

  test("should not overwrite files when overwrite is cancelled", async () => {
    // Mock the showInformationMessage to simulate user clicking "Generate"
    const mockShowInfo = async () => ({ title: "Generate" });
    const originalShowInfo = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = mockShowInfo as any;

    // Mock the showWarningMessage to simulate user clicking "Cancel"
    const mockShowWarning = async () => ({ title: "Cancel" });
    const originalShowWarning = vscode.window.showWarningMessage;
    vscode.window.showWarningMessage = mockShowWarning as any;

    try {
      // Create files first
      const firstResult = await systemServiceGenerator.generateServiceFile(
        testTunnelId,
        testTunnelName,
        testPort
      );

      // Try to generate again
      await assert.rejects(
        () =>
          systemServiceGenerator.generateServiceFile(
            testTunnelId,
            testTunnelName,
            testPort
          ),
        /User cancelled overwriting existing files/
      );

      // Verify original files still exist
      assert.ok(fs.existsSync(firstResult.servicePath!));
      assert.ok(fs.existsSync(firstResult.envPath!));
    } finally {
      vscode.window.showInformationMessage = originalShowInfo;
      vscode.window.showWarningMessage = originalShowWarning;
    }
  });
}); 