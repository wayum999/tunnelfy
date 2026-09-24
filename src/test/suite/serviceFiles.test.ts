import * as assert from "assert";
import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import {
  appendGitignoreEntry,
  assertValidTunnelName,
  ENV_FILE_MODE,
  isIgnoredByGit,
  offerGitignoreEntry,
  resolveInsideWorkspace,
  tunnelNameError,
  writeServiceFiles,
} from "../../services/serviceFiles";
import { DockerComposeGenerator } from "../../services/dockerComposeGenerator";
import { SystemServiceGenerator } from "../../services/systemServiceGenerator";
import { ServiceGenerator } from "../../services/serviceGenerator";
import { TunnelManager } from "../../services/cloudflared";
import { CloudflareApiService } from "../../services/cloudflareApi";

// Not a real token: generators only copy it into the env file.
const FAKE_TOKEN = "fake-tunnel-token-for-tests";

function fileMode(filePath: string): number {
  return fs.statSync(filePath).mode & 0o777;
}

suite("Service file safety", () => {
  let workspaceRoot: string;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunnelfy-svc-"));
  });

  teardown(() => {
    sinon.restore();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test("tunnel names outside the allowed pattern are rejected", () => {
    for (const bad of [
      "",
      "-leading-dash",
      "_leading-underscore",
      "has space",
      "../escape",
      "a/b",
      "a\\b",
      "semi;colon",
      "line\nbreak",
      "yaml: injection",
      "a".repeat(64),
    ]) {
      assert.notStrictEqual(tunnelNameError(bad), null, `accepted ${JSON.stringify(bad)}`);
      assert.throws(() => assertValidTunnelName(bad));
    }
    for (const good of ["a", "my-tunnel", "My_Tunnel-2", "9lives", "a".repeat(63)]) {
      assert.strictEqual(tunnelNameError(good), null, `rejected ${good}`);
    }
  });

  test("resolveInsideWorkspace refuses paths that escape the workspace", () => {
    assert.strictEqual(
      resolveInsideWorkspace(workspaceRoot, "cloudflare.ok.env"),
      path.join(workspaceRoot, "cloudflare.ok.env"),
    );
    for (const escape of ["../outside.env", "/etc/passwd", "sub/../../x", "."]) {
      assert.throws(() => resolveInsideWorkspace(workspaceRoot, escape), /outside the workspace/);
    }
  });

  test("writeServiceFiles writes the env file 0600, including over an existing file", function () {
    if (process.platform === "win32") {
      this.skip();
    }
    const envPath = path.join(workspaceRoot, "cloudflared-t.env");
    fs.writeFileSync(envPath, "old", { mode: 0o644 });

    const written = writeServiceFiles(workspaceRoot, {
      serviceFileName: "cloudflared-t.service",
      serviceContent: "[Unit]\n",
      envFileName: "cloudflared-t.env",
      envContent: `TUNNEL_TOKEN=${FAKE_TOKEN}\n`,
    });

    assert.strictEqual(written.envPath, envPath);
    assert.strictEqual(fileMode(envPath), ENV_FILE_MODE);
    assert.strictEqual(fs.readFileSync(envPath, "utf8"), `TUNNEL_TOKEN=${FAKE_TOKEN}\n`);
    assert.strictEqual(fs.readFileSync(written.servicePath, "utf8"), "[Unit]\n");
  });

  test("isIgnoredByGit reflects .gitignore in a real repository", async () => {
    cp.execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
    const envPath = path.join(workspaceRoot, "cloudflare.t.env");
    fs.writeFileSync(envPath, "x");

    assert.strictEqual(await isIgnoredByGit(workspaceRoot, envPath), false);
    appendGitignoreEntry(workspaceRoot, "cloudflare.t.env");
    assert.strictEqual(await isIgnoredByGit(workspaceRoot, envPath), true);
  });

  test("offerGitignoreEntry adds the entry when the user accepts", async () => {
    cp.execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
    fs.writeFileSync(path.join(workspaceRoot, ".gitignore"), "node_modules");
    const envPath = path.join(workspaceRoot, "cloudflare.t.env");
    fs.writeFileSync(envPath, "x");
    const warn = sinon
      .stub(vscode.window, "showWarningMessage")
      .resolves("Add to .gitignore" as any);

    await offerGitignoreEntry(workspaceRoot, envPath);

    assert.strictEqual(warn.callCount, 1);
    assert.match(String(warn.firstCall.args[0]), /tunnel token/);
    const gitignore = fs.readFileSync(path.join(workspaceRoot, ".gitignore"), "utf8");
    assert.ok(gitignore.startsWith("node_modules\n"), "existing last line not terminated");
    assert.ok(gitignore.split("\n").includes("/cloudflare.t.env"));
    assert.strictEqual(await isIgnoredByGit(workspaceRoot, envPath), true);
  });

  test("offerGitignoreEntry stays silent outside a git repository and when already ignored", async () => {
    const warn = sinon.stub(vscode.window, "showWarningMessage").resolves(undefined);
    const envPath = path.join(workspaceRoot, "cloudflare.t.env");
    fs.writeFileSync(envPath, "x");

    // os.tmpdir() is not inside a repository
    await offerGitignoreEntry(workspaceRoot, envPath);
    assert.strictEqual(warn.callCount, 0);

    cp.execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
    fs.writeFileSync(path.join(workspaceRoot, ".gitignore"), "*.env\n");
    await offerGitignoreEntry(workspaceRoot, envPath);
    assert.strictEqual(warn.callCount, 0);
  });
});

suite("Service file generators", () => {
  let workspaceRoot: string;
  let opened: string[];

  const apiService = {
    getTunnelToken: async () => FAKE_TOKEN,
  } as unknown as CloudflareApiService;
  const tunnelManager = {} as TunnelManager;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunnelfy-gen-"));
    opened = [];
    sinon
      .stub(vscode.window, "showInformationMessage")
      .resolves({ title: "Generate" } as any);
    sinon.stub(vscode.window, "showWarningMessage").resolves(undefined);
    sinon.stub(vscode.window, "showTextDocument").resolves(undefined as any);
    sinon.stub(vscode.workspace, "openTextDocument").callsFake(async (arg: any) => {
      opened.push(arg instanceof vscode.Uri ? arg.fsPath : "untitled");
      return {} as vscode.TextDocument;
    });
  });

  teardown(() => {
    sinon.restore();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function pointAt<T>(generator: T): T {
    sinon.stub(generator as any, "getWorkspaceFolder").returns({
      uri: vscode.Uri.file(workspaceRoot),
      name: "test",
      index: 0,
    });
    return generator;
  }

  function assertEnvFile(envPath: string, expectedFile: string): void {
    assert.strictEqual(envPath, path.join(workspaceRoot, expectedFile));
    assert.strictEqual(fs.readFileSync(envPath, "utf8"), `TUNNEL_TOKEN=${FAKE_TOKEN}\n`);
    if (process.platform !== "win32") {
      assert.strictEqual(fileMode(envPath), 0o600, `${expectedFile} mode`);
    }
    assert.ok(!opened.includes(envPath), "env file was opened in an editor");
  }

  test("DockerComposeGenerator writes a 0600 env file and opens only the compose file", async () => {
    const generator = pointAt(new DockerComposeGenerator(tunnelManager, apiService));

    const composePath = await generator.generateComposeFile("tunnel-id", "web-app", 8080);

    assert.strictEqual(composePath, path.join(workspaceRoot, "docker-compose.web-app.yml"));
    const compose = fs.readFileSync(composePath, "utf8");
    assert.ok(compose.includes("  web-app:\n"));
    assert.ok(compose.includes("--url http://host.docker.internal:8080 run"));
    assert.ok(!compose.includes(FAKE_TOKEN), "token leaked into compose file");
    assertEnvFile(path.join(workspaceRoot, "cloudflare.web-app.env"), "cloudflare.web-app.env");
    assert.deepStrictEqual(opened, [composePath]);
  });

  test("SystemServiceGenerator writes a 0600 env file and opens only the unit file", async () => {
    const generator = pointAt(new SystemServiceGenerator(tunnelManager, apiService));

    const result = await generator.generateServiceFile("tunnel-id", "web-app", 3000);

    assert.strictEqual(result.type, "workspace");
    const unit = fs.readFileSync(result.servicePath!, "utf8");
    assert.ok(unit.includes("Description=Cloudflare Tunnel - web-app"));
    assert.ok(unit.includes("--url http://localhost:3000 run"));
    assert.ok(!unit.includes(FAKE_TOKEN), "token leaked into unit file");
    assertEnvFile(result.envPath!, "cloudflared-web-app.env");
    assert.deepStrictEqual(opened, [result.servicePath]);
  });

  for (const serviceType of ["docker", "system"] as const) {
    test(`ServiceGenerator (${serviceType}) writes a 0600 env file and opens only the service file`, async () => {
      const generator = pointAt(new ServiceGenerator(tunnelManager, apiService));

      const result = await generator.generateServiceFile("tunnel-id", "web-app", 8080, serviceType);

      assert.strictEqual(result.serviceType, serviceType);
      const service = fs.readFileSync(result.servicePath!, "utf8");
      assert.ok(service.includes("web-app"));
      assert.ok(!service.includes(FAKE_TOKEN), "token leaked into service file");
      assertEnvFile(
        result.envPath!,
        serviceType === "docker" ? "cloudflare.web-app.env" : "cloudflared-web-app.env",
      );
      assert.deepStrictEqual(opened, [result.servicePath]);
    });
  }

  test("every generator rejects an unsafe tunnel name before writing anything", async () => {
    const badName = "../../evil";
    await assert.rejects(
      pointAt(new DockerComposeGenerator(tunnelManager, apiService)).generateComposeFile("id", badName, 80),
      /Tunnel name must/,
    );
    await assert.rejects(
      pointAt(new SystemServiceGenerator(tunnelManager, apiService)).generateServiceFile("id", badName, 80),
      /Tunnel name must/,
    );
    await assert.rejects(
      pointAt(new ServiceGenerator(tunnelManager, apiService)).generateServiceFile("id", badName, 80, "docker"),
      /Tunnel name must/,
    );
    assert.deepStrictEqual(fs.readdirSync(workspaceRoot), []);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(workspaceRoot)).filter((f) => f.includes("evil")), []);
  });
});
