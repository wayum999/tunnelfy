import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as sinon from "sinon";
// The raw module object, so a stub is seen by every caller of child_process
import childProcess = require("child_process");
import { activate, deactivate } from "../../extension";
import { TunnelTreeDataProvider, TunnelListErrorItem } from "../../views/tunnelTreeView";
import { QuickTunnelTreeDataProvider } from "../../views/quickTunnelTreeView";
import { TunnelManager } from "../../services/cloudflared";
import { ProfileManager } from "../../services/profileManager";
import { Logger } from "../../utils/logger";
import { Messages } from "../../utils/messages";
import { TunnelProcessRegistry } from "../../services/cloudflared/TunnelProcessRegistry";
import { CloudflareApiService } from "../../services/cloudflareApi";

const VIEW_IDS = ["tunnelfy-profiles", "tunnelfy-tunnels", "tunnelfy-quick-tunnels"];

interface TrackedDisposable extends vscode.Disposable {
  disposed: boolean;
}

function trackedDisposable(): TrackedDisposable {
  const tracked = {
    disposed: false,
    dispose: () => {
      tracked.disposed = true;
    },
  };
  return tracked;
}

/** A tunnel manager whose onTunnelEvent subscription can be checked for disposal */
function fakeTunnelManager(overrides: Record<string, unknown> = {}) {
  const subscriptions: TrackedDisposable[] = [];
  const manager = {
    onTunnelEvent: () => {
      const subscription = trackedDisposable();
      subscriptions.push(subscription);
      return subscription;
    },
    listTunnels: sinon.stub().resolves([]),
    getTunnelConfig: sinon.stub().resolves(undefined),
    getQuickTunnels: sinon.stub().resolves([]),
    ...overrides,
  } as unknown as TunnelManager;
  return { manager, subscriptions };
}

/** Records every child_process call and fails it, so nothing real runs */
function stubChildProcess(sandbox: sinon.SinonSandbox): string[] {
  const calls: string[] = [];
  // Records the command and its argument list only: options carry the environment
  const describeCall = (name: string, command: unknown, args: unknown) =>
    `${name} ${String(command)}${Array.isArray(args) ? ` ${args.map(String).join(" ")}` : ""}`;
  const failWithCallback = (name: string) => (...args: unknown[]) => {
    calls.push(describeCall(name, args[0], args[1]));
    const callback = args.find((arg) => typeof arg === "function") as ((error: Error) => void) | undefined;
    if (callback) {
      setImmediate(() => callback(new Error("ENOENT: stubbed child_process")));
    }
    return { on: () => undefined, once: () => undefined, kill: () => false } as unknown as childProcess.ChildProcess;
  };
  sandbox.stub(childProcess, "exec").callsFake(failWithCallback("exec") as never);
  sandbox.stub(childProcess, "execFile").callsFake(failWithCallback("execFile") as never);
  sandbox.stub(childProcess, "execSync").callsFake(((...args: unknown[]) => {
    calls.push(describeCall("execSync", args[0], undefined));
    throw new Error("ENOENT: stubbed child_process");
  }) as never);
  sandbox.stub(childProcess, "spawn").callsFake(((...args: unknown[]) => {
    calls.push(describeCall("spawn", args[0], args[1]));
    throw new Error("ENOENT: stubbed child_process");
  }) as never);
  return calls;
}

function inMemoryMemento(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    keys: () => [...values.keys()],
    get: (key: string, defaultValue?: unknown) => (values.has(key) ? values.get(key) : defaultValue),
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  } as vscode.Memento;
}

function mockExtensionContext(storageDir: string): vscode.ExtensionContext {
  const secrets = new Map<string, string>();
  return {
    subscriptions: [],
    extensionPath: storageDir,
    globalStoragePath: storageDir,
    storagePath: storageDir,
    logPath: storageDir,
    asAbsolutePath: (relativePath: string) => path.join(storageDir, relativePath),
    workspaceState: inMemoryMemento(),
    globalState: inMemoryMemento(),
    extensionUri: vscode.Uri.file(storageDir),
    storageUri: vscode.Uri.file(storageDir),
    globalStorageUri: vscode.Uri.file(storageDir),
    logUri: vscode.Uri.file(storageDir),
    extensionMode: vscode.ExtensionMode.Test,
    secrets: {
      get: async (key: string) => secrets.get(key),
      store: async (key: string, value: string) => {
        secrets.set(key, value);
      },
      delete: async (key: string) => {
        secrets.delete(key);
      },
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    },
  } as unknown as vscode.ExtensionContext;
}

suite("Activation hygiene (TUNNEL-85, TUNNEL-86)", () => {
  let sandbox: sinon.SinonSandbox;
  let treeViews: Array<{ id: string; view: TrackedDisposable }>;

  setup(() => {
    sandbox = sinon.createSandbox();
    treeViews = [];
    sandbox.stub(vscode.window, "createTreeView").callsFake(((id: string) => {
      const view = trackedDisposable();
      treeViews.push({ id, view });
      return view;
    }) as never);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite("tree view disposal (85.1)", () => {
    test("disposing the tunnel tree view drops its tunnel listener and its tree view", () => {
      const { manager, subscriptions } = fakeTunnelManager();
      const provider = new TunnelTreeDataProvider(manager, {} as ProfileManager);
      assert.strictEqual(subscriptions.length, 1);

      provider.dispose();

      assert.ok(subscriptions.every((subscription) => subscription.disposed), "tunnel event listener left subscribed");
      assert.ok(treeViews.every(({ view }) => view.disposed), "tree view left undisposed");
    });

    test("disposing the quick tunnel tree view clears its refresh interval and drops its listener", () => {
      const clock = sandbox.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { manager, subscriptions } = fakeTunnelManager();
      const provider = new QuickTunnelTreeDataProvider(manager);
      assert.strictEqual(clock.countTimers(), 1, "expected the auto-refresh interval to be set");

      provider.dispose();

      assert.strictEqual(clock.countTimers(), 0, "auto-refresh interval still pending after dispose");
      assert.ok(subscriptions.every((subscription) => subscription.disposed), "tunnel event listener left subscribed");
      assert.ok(treeViews.every(({ view }) => view.disposed), "tree view left undisposed");
    });
  });

  suite("one list call per refresh (85.3)", () => {
    const renderTree = async (provider: TunnelTreeDataProvider) => {
      const groups = await provider.getChildren();
      return Promise.all(groups.map((group) => provider.getChildren(group)));
    };

    test("a refresh lists tunnels once for both groups", async () => {
      const listTunnels = sinon.stub().resolves([
        { id: "remote-1", name: "remote", remote_config: true, connections: [] },
        { id: "local-1", name: "local", remote_config: false, connections: [] },
      ]);
      const { manager } = fakeTunnelManager({ listTunnels });
      const profileManager = { getActiveProfile: async () => "profile" } as unknown as ProfileManager;
      const provider = new TunnelTreeDataProvider(manager, profileManager);

      provider.refresh();
      const [remote, local] = await renderTree(provider);
      assert.strictEqual(listTunnels.callCount, 1, "one refresh made more than one listTunnels call");
      assert.deepStrictEqual(remote.map((item) => item.label), ["remote"]);
      assert.deepStrictEqual(local.map((item) => item.label), ["local"]);

      provider.refresh();
      await renderTree(provider);
      assert.strictEqual(listTunnels.callCount, 2, "a second refresh must list tunnels afresh");
      provider.dispose();
    });

    test("a group expanded after a render lists tunnels afresh", async () => {
      const listTunnels = sinon.stub();
      listTunnels.onFirstCall().resolves([{ id: "remote-1", name: "old", remote_config: true, connections: [] }]);
      listTunnels.onSecondCall().resolves([{ id: "remote-1", name: "new", remote_config: true, connections: [] }]);
      const { manager } = fakeTunnelManager({ listTunnels });
      const profileManager = { getActiveProfile: async () => "profile" } as unknown as ProfileManager;
      const provider = new TunnelTreeDataProvider(manager, profileManager);

      const [remoteGroup] = await provider.getChildren();
      await provider.getChildren(remoteGroup);
      // Collapse All, then expand: VS Code asks the group again with no root render
      const expanded = await provider.getChildren(remoteGroup);

      assert.strictEqual(listTunnels.callCount, 2, "a later expand reused the list of an earlier render");
      assert.deepStrictEqual(expanded.map((item) => item.label), ["new"]);
      provider.dispose();
    });

    test("a failed list call is retried by the next expand, not kept as an error", async () => {
      const listTunnels = sinon.stub();
      listTunnels.onFirstCall().rejects(new Error("API down"));
      listTunnels.onSecondCall().resolves([{ id: "remote-1", name: "remote", remote_config: true, connections: [] }]);
      const { manager } = fakeTunnelManager({ listTunnels });
      const profileManager = { getActiveProfile: async () => "profile" } as unknown as ProfileManager;
      const provider = new TunnelTreeDataProvider(manager, profileManager);

      const [remoteGroup] = await provider.getChildren();
      const failed = await provider.getChildren(remoteGroup);
      assert.ok(failed[0] instanceof TunnelListErrorItem, "expected the first call's error item");

      const retried = await provider.getChildren(remoteGroup);

      assert.strictEqual(listTunnels.callCount, 2, "the failed call was not retried");
      assert.deepStrictEqual(retried.map((item) => item.label), ["remote"], "the error item stuck");
      provider.dispose();
    });

    test("one failed list call still reaches both groups as an error item", async () => {
      const listTunnels = sinon.stub().rejects(new Error("API down"));
      const { manager } = fakeTunnelManager({ listTunnels });
      const profileManager = { getActiveProfile: async () => "profile" } as unknown as ProfileManager;
      const provider = new TunnelTreeDataProvider(manager, profileManager);

      provider.refresh();
      const groups = await renderTree(provider);
      assert.strictEqual(listTunnels.callCount, 1);
      for (const items of groups) {
        assert.strictEqual(items.length, 1);
        assert.ok(items[0] instanceof TunnelListErrorItem, "list error did not reach the group");
      }
      provider.dispose();
    });
  });

  suite("tunnel manager disposal (85.1)", () => {
    test("disposing the tunnel manager drops its registry listener", () => {
      const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "tunnelfy-manager-dispose-"));
      const registrySubscription = trackedDisposable();
      const registry = {
        onDidChange: () => registrySubscription,
      } as unknown as TunnelProcessRegistry;
      const manager = new TunnelManager(
        mockExtensionContext(storageDir),
        Logger.getInstance(),
        {} as CloudflareApiService,
        {} as ProfileManager,
        registry,
      );

      manager.dispose();

      assert.ok(registrySubscription.disposed, "registry listener left subscribed");
    });
  });

  suite("activate (85.1, 85.2, 86.2)", () => {
    let storageDir: string;
    let context: vscode.ExtensionContext;
    let childProcessCalls: string[];
    let registeredViews: string[];
    let commandHandlers: Map<string, (...args: unknown[]) => unknown>;
    let clock: sinon.SinonFakeTimers;
    let showErrorMessage: sinon.SinonStub;

    // One directory for the whole run and never removed mid-run: activation points the
    // shared logger's file stream into it, and later suites keep logging there
    suiteSetup(() => {
      storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "tunnelfy-activation-"));
    });

    setup(async () => {
      context = mockExtensionContext(storageDir);
      showErrorMessage = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
      childProcessCalls = stubChildProcess(sandbox);
      registeredViews = [];
      commandHandlers = new Map();
      sandbox.stub(vscode.window, "registerTreeDataProvider").callsFake(((id: string) => {
        registeredViews.push(id);
        return trackedDisposable();
      }) as never);
      sandbox.stub(vscode.commands, "registerCommand").callsFake(((id: string, handler: (...args: unknown[]) => unknown) => {
        commandHandlers.set(id, handler);
        return trackedDisposable();
      }) as never);
      clock = sandbox.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

      await activate(context);
    });

    teardown(async () => {
      disposeSubscriptions();
      await deactivate();
    });

    /** Disposes what activation registered, sparing the shared logger's output channel */
    const disposeSubscriptions = () => {
      const sharedOutputChannel = (Logger.getInstance() as unknown as { outputChannel: unknown }).outputChannel;
      for (const subscription of context.subscriptions) {
        if (subscription !== sharedOutputChannel) {
          subscription.dispose();
        }
      }
    };

    test("each view is registered exactly once", () => {
      const registrations = [...registeredViews, ...treeViews.map(({ id }) => id)].sort();
      assert.deepStrictEqual(registrations, [...VIEW_IDS].sort());
    });

    test("activation neither spawns nor probes cloudflared", async () => {
      // Let any background work activation started reach child_process
      await new Promise((resolve) => setImmediate(resolve));
      const cloudflaredCalls = childProcessCalls.filter((call) => /cloudflared/i.test(call));
      assert.deepStrictEqual(cloudflaredCalls, [], "activation ran cloudflared");
      assert.ok(showErrorMessage.notCalled, "activation showed an error");
    });

    test("disposing the extension's subscriptions clears every timer and listener", () => {
      assert.ok(clock.countTimers() > 0, "expected activation to set the auto-refresh interval");

      disposeSubscriptions();

      assert.strictEqual(clock.countTimers(), 0, "an interval is still pending after the extension was disposed");
      const undisposed = treeViews.filter(({ view }) => !view.disposed).map(({ id }) => id);
      assert.deepStrictEqual(undisposed, [], "tree views left undisposed");
    });

    test("deactivate disposes the tunnel manager once its tunnels are stopped", async () => {
      const dispose = sandbox.spy(TunnelManager.prototype, "dispose");

      await deactivate();

      assert.ok(dispose.calledOnce, "deactivate left the tunnel manager undisposed");
    });

    for (const commandId of ["tunnelfy.startTunnel", "tunnelfy.createQuickTunnel"]) {
      test(`${commandId} with no cloudflared shows the missing-binary message`, async () => {
        const showQuickPick = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
        const showInputBox = sandbox.stub(vscode.window, "showInputBox").resolves(undefined);
        const handler = commandHandlers.get(commandId);
        assert.ok(handler, `${commandId} was not registered`);

        await handler();

        assert.ok(
          showErrorMessage.getCalls().some((call) => call.args[0] === Messages.CLOUDFLARED_NOT_FOUND.message),
          "missing-binary message not shown",
        );
        assert.ok(childProcessCalls.some((call) => /cloudflared/.test(call)), "the action did not check for cloudflared");
        assert.ok(showQuickPick.notCalled && showInputBox.notCalled, "the action went on without cloudflared");
      });
    }
  });
});
