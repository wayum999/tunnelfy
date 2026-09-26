import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import {
  serviceCommandArgs,
  reportTunnelStop,
  ownedTunnelStopItems,
} from "../../commands/tunnelCommands";
import { reportQuickTunnelStop } from "../../commands/quickTunnelCommands";
import { TunnelTreeItem } from "../../views/tunnelTreeView";
import { QuickTunnelTreeItem } from "../../views/quickTunnelTreeView";
import { Messages } from "../../utils/messages";
import { OwnedTunnelRecord } from "../../services/cloudflared";
import { waitForExtensionActivation } from "./testUtils";

suite("Tunnel commands", () => {
  test("generateDockerCompose/generateSystemService pass the tree item's id and name", () => {
    const item = new TunnelTreeItem("web-app", "0b1c2d3e-id", "stopped", "local", false);

    assert.deepStrictEqual(serviceCommandArgs(item, "docker"), ["0b1c2d3e-id", "web-app", "docker"]);
    assert.deepStrictEqual(serviceCommandArgs(item, "system"), ["0b1c2d3e-id", "web-app", "system"]);
  });

  test("without a tree item the service type is kept and the picker is used", () => {
    assert.deepStrictEqual(serviceCommandArgs(undefined, "docker"), [undefined, undefined, "docker"]);
  });

  suite("stop reporting (3.5)", () => {
    let info: sinon.SinonStub;
    let warning: sinon.SinonStub;
    let error: sinon.SinonStub;

    setup(() => {
      info = sinon.stub(Messages, "showInfo").resolves();
      warning = sinon.stub(Messages, "showWarning").resolves(undefined);
      error = sinon.stub(Messages, "showError").resolves(undefined);
    });

    teardown(() => sinon.restore());

    test("stopped shows the stopped message", async () => {
      await reportTunnelStop({ tunnelId: "t", outcome: "stopped" }, "web");
      assert.deepStrictEqual(info.args, [[Messages.TUNNEL_STOPPED("web")]]);
      assert.strictEqual(warning.callCount + error.callCount, 0);
    });

    test("not-owned shows no success message", async () => {
      await reportTunnelStop({ tunnelId: "t", outcome: "not-owned" }, "web");
      assert.strictEqual(info.callCount, 0, "success message shown for a tunnel that was not stopped");
      assert.deepStrictEqual(warning.args, [[Messages.TUNNEL_NOT_OWNED("web")]]);
    });

    test("failed shows the stop-failed message with the reason", async () => {
      await reportTunnelStop({ tunnelId: "t", outcome: "failed", reason: "identity-mismatch" }, "web");
      assert.strictEqual(info.callCount, 0);
      assert.deepStrictEqual(error.args, [[Messages.TUNNEL_STOP_FAILED("web", "identity-mismatch")]]);
      assert.ok(/no longer the tunnel/.test(Messages.TUNNEL_STOP_FAILED("web", "identity-mismatch").detail));
    });

    test("quick tunnel outcomes are reported the same way", async () => {
      await reportQuickTunnelStop({ tunnelId: "q", outcome: "stopped" }, "demo", 8080);
      await reportQuickTunnelStop({ tunnelId: "q", outcome: "not-owned" }, "demo", 8080);
      await reportQuickTunnelStop({ tunnelId: "q", outcome: "failed", reason: "kill-error: EPERM" }, undefined, 8080);
      assert.deepStrictEqual(info.args, [[Messages.QUICK_TUNNEL_STOPPED("demo", 8080)]]);
      assert.deepStrictEqual(warning.args, [[Messages.QUICK_TUNNEL_NOT_OWNED(8080)]]);
      assert.strictEqual(error.callCount, 1);
      assert.ok(String(error.firstCall.args[0].detail).includes("EPERM"));
    });
  });

  suite("palette stop list (11.2)", () => {
    const owned: OwnedTunnelRecord = {
      tunnelId: "mine", pid: 101, startedAt: 1, kind: "named", target: "http://localhost:3000",
    };
    const cloudflareTunnels = [
      { id: "mine", name: "My Tunnel", connections: [{}] },
      { id: "elsewhere", name: "Started In A Terminal", connections: [{}, {}] },
    ];

    test("lists only tunnels the extension owns, named from Cloudflare", async () => {
      const items = await ownedTunnelStopItems(
        { listOwnedTunnels: (kind?: string) => (kind === "named" ? [owned] : []) } as any,
        { listTunnels: async () => cloudflareTunnels } as any,
      );
      assert.deepStrictEqual(items.map((i) => [i.tunnelId, i.label]), [["mine", "My Tunnel"]]);
    });

    test("with nothing owned the list is empty and Cloudflare is not asked", async () => {
      let asked = false;
      const items = await ownedTunnelStopItems(
        { listOwnedTunnels: () => [] } as any,
        { listTunnels: async () => { asked = true; return cloudflareTunnels; } } as any,
      );
      assert.deepStrictEqual(items, []);
      assert.strictEqual(asked, false);
    });

    test("falls back to the id when names cannot be loaded", async () => {
      const items = await ownedTunnelStopItems(
        { listOwnedTunnels: () => [owned] } as any,
        { listTunnels: async () => { throw new Error("offline"); } } as any,
      );
      assert.deepStrictEqual(items.map((i) => i.label), ["mine"]);
    });
  });

  // The activated extension runs from its own bundle, so these stub vscode.window,
  // which it shares with the tests, rather than the tests' copy of Messages.
  suite("registered stop commands against the activated extension (3.5, 11.2)", () => {
    let infos: string[];
    let warnings: string[];
    let quickPick: sinon.SinonStub;

    suiteSetup(async function () {
      this.timeout(20000);
      await waitForExtensionActivation();
    });

    setup(() => {
      infos = [];
      warnings = [];
      (sinon.stub(vscode.window, "showInformationMessage") as sinon.SinonStub).callsFake(async (message: string) => {
        infos.push(message);
        return undefined;
      });
      (sinon.stub(vscode.window, "showWarningMessage") as sinon.SinonStub).callsFake(async (message: string, ...rest: any[]) => {
        if (rest[0] && typeof rest[0] === "object" && rest[0].modal) {
          return "Stop"; // confirm the modal
        }
        warnings.push(message);
        return undefined;
      });
      sinon.stub(vscode.window, "showErrorMessage").resolves(undefined);
      quickPick = sinon.stub(vscode.window, "showQuickPick").resolves(undefined);
    });

    teardown(() => sinon.restore());

    test("stopping a tunnel the extension did not start shows no success message", async () => {
      const item = new TunnelTreeItem("Not Mine", "not-started-here", "running", "local", false);
      await vscode.commands.executeCommand("tunnelfy.stopTunnel", item);
      assert.ok(!infos.includes(Messages.TUNNEL_STOPPED("Not Mine")), "claimed a stop");
      assert.deepStrictEqual(warnings, [Messages.TUNNEL_NOT_OWNED("Not Mine")]);
    });

    test("the palette offers nothing when the extension owns no tunnel", async () => {
      await vscode.commands.executeCommand("tunnelfy.stopTunnel");
      assert.strictEqual(quickPick.callCount, 0, "offered tunnels the extension does not own");
      assert.deepStrictEqual(infos, [Messages.NO_OWNED_TUNNELS]);
    });

    test("stopping an unknown quick tunnel shows no success message", async () => {
      const item = new QuickTunnelTreeItem("quick-9-1", 9, "running");
      await vscode.commands.executeCommand("tunnelfy.stopQuickTunnel", item);
      assert.ok(!infos.includes(Messages.QUICK_TUNNEL_STOPPED(undefined, 9)), "claimed a stop");
      assert.deepStrictEqual(warnings, [Messages.QUICK_TUNNEL_NOT_OWNED(9)]);
    });
  });
});
