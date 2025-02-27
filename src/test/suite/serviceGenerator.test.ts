import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as path from "path";
import proxyquire from "proxyquire";

// Import the real modules
import { TunnelManager } from "../../services/cloudflared";
import { CloudflareApiService } from "../../services/cloudflareApi";
import { ServiceType } from "../../services/serviceGenerator";

// Create fs mock
const fsMock = {
  writeFileSync: sinon.stub(),
  existsSync: sinon.stub().returns(false),
  mkdirSync: sinon.stub(),
  '@noCallThru': true
};

// Create a mock for vscode.workspace.fs
const workspaceFsMock = {
  stat: sinon.stub().resolves({ type: vscode.FileType.Directory } as vscode.FileStat),
  writeFile: sinon.stub().resolves(),
  createDirectory: sinon.stub().resolves(),
  readFile: sinon.stub().resolves(Buffer.from(''))
};

// Import ServiceGenerator with mocked fs
const { ServiceGenerator } = proxyquire.noCallThru().load("../../services/serviceGenerator", {
  fs: fsMock
});

suite("ServiceGenerator Test Suite", () => {
  let serviceGenerator: any;
  let mockTunnelManager: sinon.SinonStubbedInstance<TunnelManager>;
  let mockApiService: sinon.SinonStubbedInstance<CloudflareApiService>;
  let mockShowInfoMessage: sinon.SinonStub;
  let mockShowWarningMessage: sinon.SinonStub;
  let mockOpenTextDocument: sinon.SinonStub;
  let mockShowTextDocument: sinon.SinonStub;
  let originalWorkspaceFs: any;

  setup(() => {
    // Reset fs mock stubs
    fsMock.writeFileSync.reset();
    fsMock.existsSync.reset();
    fsMock.existsSync.returns(false);
    fsMock.mkdirSync.reset();

    // Save original workspace.fs
    originalWorkspaceFs = vscode.workspace.fs;
    
    // Replace workspace.fs with our mock
    // This is a workaround since we can't directly stub the methods
    Object.defineProperty(vscode.workspace, 'fs', {
      value: workspaceFsMock,
      configurable: true
    });

    // Reset workspace fs mocks
    workspaceFsMock.stat.reset();
    workspaceFsMock.stat.resolves({ type: vscode.FileType.Directory } as vscode.FileStat);
    workspaceFsMock.writeFile.reset();
    workspaceFsMock.writeFile.resolves();
    workspaceFsMock.createDirectory.reset();
    workspaceFsMock.createDirectory.resolves();

    // Create mock objects
    mockTunnelManager = sinon.createStubInstance(TunnelManager);
    mockApiService = sinon.createStubInstance(CloudflareApiService);
    mockApiService.getTunnelToken.resolves("mock-token");

    // Create stubs for vscode API
    mockShowInfoMessage = sinon.stub(vscode.window, "showInformationMessage");
    mockShowInfoMessage.resolves({ title: "Generate" });
    mockShowWarningMessage = sinon.stub(vscode.window, "showWarningMessage");
    mockShowWarningMessage.resolves({ title: "Overwrite" });
    mockOpenTextDocument = sinon.stub(vscode.workspace, "openTextDocument");
    mockOpenTextDocument.resolves({});
    mockShowTextDocument = sinon.stub(vscode.window, "showTextDocument");
    mockShowTextDocument.resolves();

    // Create the service generator
    serviceGenerator = new ServiceGenerator(
      mockTunnelManager as unknown as TunnelManager,
      mockApiService as unknown as CloudflareApiService
    );

    // Mock workspace folders
    sinon.stub(vscode.workspace, "workspaceFolders").value([
      {
        uri: {
          scheme: "file",
          fsPath: "/mock/workspace",
        },
      },
    ]);
  });

  teardown(() => {
    // Restore original workspace.fs
    if (originalWorkspaceFs) {
      Object.defineProperty(vscode.workspace, 'fs', {
        value: originalWorkspaceFs,
        configurable: true
      });
    }
    
    sinon.restore();
  });

  test("generateServiceFile should generate Docker Compose files", async () => {
    const result = await serviceGenerator.generateServiceFile(
      "mock-tunnel-id",
      "mock-tunnel",
      8080,
      "docker"
    );

    assert.strictEqual(result.type, "workspace");
    assert.strictEqual(result.serviceType, "docker");
    assert.strictEqual(
      result.servicePath,
      path.join("/mock/workspace", "docker-compose.mock-tunnel.yml")
    );
    assert.strictEqual(
      result.envPath,
      path.join("/mock/workspace", "cloudflare.mock-tunnel.env")
    );

    // Verify API was called to get token
    assert.ok(mockApiService.getTunnelToken.calledWith("mock-tunnel-id"));

    // Verify files were written
    assert.ok(fsMock.writeFileSync.calledTwice);
    assert.ok(
      fsMock.writeFileSync.calledWith(
        path.join("/mock/workspace", "docker-compose.mock-tunnel.yml"),
        sinon.match.string
      )
    );
    assert.ok(
      fsMock.writeFileSync.calledWith(
        path.join("/mock/workspace", "cloudflare.mock-tunnel.env"),
        "TUNNEL_TOKEN=mock-token\n"
      )
    );
  });

  test("generateServiceFile should generate System Service files", async () => {
    const result = await serviceGenerator.generateServiceFile(
      "mock-tunnel-id",
      "mock-tunnel",
      8080,
      "system"
    );

    assert.strictEqual(result.type, "workspace");
    assert.strictEqual(result.serviceType, "system");
    assert.strictEqual(
      result.servicePath,
      path.join("/mock/workspace", "cloudflared-mock-tunnel.service")
    );
    assert.strictEqual(
      result.envPath,
      path.join("/mock/workspace", "cloudflared-mock-tunnel.env")
    );

    // Verify API was called to get token
    assert.ok(mockApiService.getTunnelToken.calledWith("mock-tunnel-id"));

    // Verify files were written
    assert.ok(fsMock.writeFileSync.calledTwice);
    assert.ok(
      fsMock.writeFileSync.calledWith(
        path.join("/mock/workspace", "cloudflared-mock-tunnel.service"),
        sinon.match.string
      )
    );
    assert.ok(
      fsMock.writeFileSync.calledWith(
        path.join("/mock/workspace", "cloudflared-mock-tunnel.env"),
        "TUNNEL_TOKEN=mock-token\n"
      )
    );
  });

  test("generateServiceFile should handle user cancellation", async () => {
    // Mock user cancelling the confirmation dialog
    mockShowInfoMessage.resolves({ title: "Cancel" });

    try {
      await serviceGenerator.generateServiceFile(
        "mock-tunnel-id",
        "mock-tunnel",
        8080,
        "docker"
      );
      assert.fail("Expected an error to be thrown");
    } catch (error: any) {
      assert.strictEqual(error.message, "User cancelled service file generation");
    }
  });

  test("generateServiceFile should handle file overwrite confirmation", async () => {
    // Mock files already existing
    fsMock.existsSync.returns(true);

    const result = await serviceGenerator.generateServiceFile(
      "mock-tunnel-id",
      "mock-tunnel",
      8080,
      "docker"
    );

    assert.strictEqual(result.type, "workspace");
    assert.ok(mockShowWarningMessage.calledOnce);
    assert.ok(fsMock.writeFileSync.calledTwice);
  });

  test("generateServiceFile should handle file overwrite cancellation", async () => {
    // Mock files already existing
    fsMock.existsSync.returns(true);
    // Mock user cancelling the overwrite dialog
    mockShowWarningMessage.resolves({ title: "Cancel" });

    try {
      await serviceGenerator.generateServiceFile(
        "mock-tunnel-id",
        "mock-tunnel",
        8080,
        "docker"
      );
      assert.fail("Expected an error to be thrown");
    } catch (error: any) {
      assert.strictEqual(error.message, "User cancelled overwriting existing files");
    }
  });

  test("generateServiceFile should handle missing token", async () => {
    // Mock API returning no token
    mockApiService.getTunnelToken.resolves(undefined);

    try {
      await serviceGenerator.generateServiceFile(
        "mock-tunnel-id",
        "mock-tunnel",
        8080,
        "docker"
      );
      assert.fail("Expected an error to be thrown");
    } catch (error: any) {
      assert.strictEqual(error.message, "Could not get tunnel token");
    }
  });

  test("generateServiceFile should create untitled files when no workspace", async () => {
    // Clean up previous stubs
    sinon.restore();
    
    // Save original workspace.fs
    originalWorkspaceFs = vscode.workspace.fs;
    
    // Replace workspace.fs with our mock
    Object.defineProperty(vscode.workspace, 'fs', {
      value: workspaceFsMock,
      configurable: true
    });
    
    // Reset workspace fs mocks
    workspaceFsMock.stat.reset();
    workspaceFsMock.stat.resolves({ type: vscode.FileType.Directory } as vscode.FileStat);
    
    // Mock no workspace folders
    sinon.stub(vscode.workspace, "workspaceFolders").value(undefined);
    
    // Re-create stubs
    mockShowInfoMessage = sinon.stub(vscode.window, "showInformationMessage");
    mockShowInfoMessage.resolves({ title: "Generate" });
    mockOpenTextDocument = sinon.stub(vscode.workspace, "openTextDocument");
    mockOpenTextDocument.resolves({});
    mockShowTextDocument = sinon.stub(vscode.window, "showTextDocument");
    mockShowTextDocument.resolves();
    mockApiService = sinon.createStubInstance(CloudflareApiService);
    mockApiService.getTunnelToken.resolves("mock-token");
    
    // Reset fs mock stubs
    fsMock.writeFileSync.reset();
    fsMock.existsSync.reset();
    fsMock.existsSync.returns(false);
    
    // Create the service generator
    serviceGenerator = new ServiceGenerator(
      mockTunnelManager as unknown as TunnelManager,
      mockApiService as unknown as CloudflareApiService
    );

    const result = await serviceGenerator.generateServiceFile(
      "mock-tunnel-id",
      "mock-tunnel",
      8080,
      "docker"
    );

    assert.strictEqual(result.type, "untitled");
    assert.strictEqual(result.serviceType, "docker");
    assert.ok(mockOpenTextDocument.calledTwice);
    assert.ok(mockShowTextDocument.calledTwice);
  });
}); 