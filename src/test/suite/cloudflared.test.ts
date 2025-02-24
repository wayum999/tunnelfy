import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import proxyquire from "proxyquire";
import { TunnelManager } from "../../services/cloudflared";
import { CloudflareApiService } from "../../services/cloudflareApi";
import { ProfileManager } from "../../services/profileManager";
import { Logger, LogComponent } from "../../utils/logger";
import {
  waitForExtensionActivation,
  clearWorkspace,
  createTestConfiguration,
  cleanupTestConfiguration,
} from "./testUtils";

// Mock fs module with state management
interface MockFsState {
  certExists: boolean;
  certContent: string;
  files: { [key: string]: string };
}

let mockFsState: MockFsState = {
  certExists: false,
  certContent: "",
  files: {},
};

// Mock objects for API error testing
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
  asAbsolutePath: (relativePath: string) => path.join(__dirname, relativePath),
  storagePath: path.join(__dirname, "storage"),
  globalStoragePath: path.join(__dirname, "globalStorage"),
  logPath: path.join(__dirname, "logs"),
} as unknown as vscode.ExtensionContext;

const mockLogger: Logger = {
  info: (component: LogComponent, message: string) => {},
  error: (component: LogComponent, message: string) => {},
  debug: (component: LogComponent, message: string) => {},
  warn: (component: LogComponent, message: string) => {},
} as unknown as Logger;

const mockProfileManager = {
  getActiveProfile: async () => "test-profile",
  getProfileAccountId: async () => "test-account-id",
  getProfileApiKey: async () => "test-api-key",
} as unknown as ProfileManager;

const mockApiService = {
  createTunnel: async (name: string) => ({
    id: `mock-id-${name}`,
    name,
    created_at: new Date().toISOString(),
    deleted_at: null,
    connections: [],
    status: "active",
  }),
  getTunnelToken: async (tunnelId: string) => "mock-token",
  getTunnelInfo: async (tunnelId: string) => ({
    id: tunnelId,
    name: "mock-tunnel",
    created_at: new Date().toISOString(),
    deleted_at: null,
    connections: [],
    status: "active",
  }),
  listTunnels: async () => [],
} as unknown as CloudflareApiService;

const mockFs = {
  existsSync: (filePath: string) => {
    if (filePath.endsWith("cert.pem")) {
      return mockFsState.certExists;
    }
    return filePath in mockFsState.files;
  },
  readFileSync: (filePath: string) => {
    if (filePath.endsWith("cert.pem")) {
      if (!mockFsState.certExists) {
        throw new Error("ENOENT: no such file or directory");
      }
      if (!mockFsState.certContent) {
        throw new Error("Certificate file is empty");
      }
      return mockFsState.certContent;
    }
    if (filePath in mockFsState.files) {
      return mockFsState.files[filePath];
    }
    throw new Error("ENOENT: no such file or directory");
  },
  writeFileSync: (filePath: string, data: string) => {
    mockFsState.files[filePath] = data;
    if (filePath.endsWith("cert.pem")) {
      mockFsState.certExists = true;
      mockFsState.certContent = data;
    }
  },
  unlinkSync: (filePath: string) => {
    if (filePath.endsWith("cert.pem")) {
      mockFsState.certExists = false;
      mockFsState.certContent = "";
    }
    delete mockFsState.files[filePath];
  },
  accessSync: (filePath: string, mode: number) => {
    if (!mockFs.existsSync(filePath)) {
      throw new Error("ENOENT: no such file or directory");
    }
    if (filePath.endsWith("cert.pem") && !mockFsState.certContent) {
      throw new Error("Certificate file is empty");
    }
  },
  statSync: (filePath: string) => {
    if (!mockFs.existsSync(filePath)) {
      throw new Error("ENOENT: no such file or directory");
    }
    if (filePath.endsWith("cert.pem") && !mockFsState.certContent) {
      throw new Error("Certificate file is empty");
    }
    return {
      isFile: () => true,
      isDirectory: () => false,
    };
  },
  constants: {
    R_OK: fs.constants.R_OK,
  },
  "@noCallThru": true,
};

// Mock child_process module
const mockChildProcess = {
  exec: (
    command: string,
    options: any,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    // Handle version check first
    if (command.includes("--version")) {
      callback(null, "cloudflared version 2023.2.1", "");
      return;
    }

    // Handle other commands
    if (command.includes("tunnel list")) {
      callback(null, "[]", "");
      return;
    }
    if (command.includes("tunnel create")) {
      const tunnelName = command.split(" ").pop() || "";
      callback(
        null,
        `Created tunnel ${tunnelName} with id mock-id-${tunnelName}`,
        "",
      );
      return;
    }
    callback(new Error("Command not mocked"), "", "Error: Command not mocked");
  },
  spawn: () => {
    const mockProcess = {
      pid: 12345,
      stdout: {
        on: (event: string, callback: (data: Buffer) => void) => {},
        pipe: (stream: any) => {},
      },
      stderr: {
        on: (event: string, callback: (data: Buffer) => void) => {},
        pipe: (stream: any) => {},
      },
      on: (
        event: string,
        callback: (code?: number, signal?: string) => void,
      ) => {},
    };
    return mockProcess;
  },
  "@noCallThru": true,
};

const { TunnelManager: MockTunnelManager } = proxyquire(
  "../../services/cloudflared",
  {
    fs: mockFs,
    child_process: mockChildProcess,
  },
);

suite("TunnelManager Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let tunnelManager: TunnelManager;

  suiteSetup(async function () {
    this.timeout(20000);
    await clearWorkspace();
    await waitForExtensionActivation();
  });

  setup(async function () {
    this.timeout(20000);
    sandbox = sinon.createSandbox();

    // Reset mock state
    mockFsState = {
      certExists: false,
      certContent: "",
      files: {},
    };

    // Create new manager instance with mocked dependencies
    tunnelManager = new MockTunnelManager(
      mockContext,
      mockLogger,
      mockApiService,
      mockProfileManager,
    );

    await createTestConfiguration();
  });

  teardown(async function () {
    this.timeout(20000);
    sandbox.restore();
    await cleanupTestConfiguration();
  });

  test("checkCloudflared should verify cloudflared installation", async function () {
    const result = await tunnelManager.checkCloudflared();
    assert.ok(
      result,
      "checkCloudflared should return a path when cloudflared is found",
    );
  });

  test("createTunnel should create a new tunnel", async function () {
    const tunnelName = "test-tunnel";
    const tunnel = await tunnelManager.createTunnel(tunnelName);
    assert.strictEqual(tunnel.name, tunnelName);
    assert.strictEqual(tunnel.id, `mock-id-${tunnelName}`);
  });

  test("listTunnels should return array of tunnels", async function () {
    const tunnels = await tunnelManager.listTunnels();
    assert.ok(Array.isArray(tunnels));
  });
});
