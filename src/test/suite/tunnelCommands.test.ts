import * as assert from "assert";
import { serviceCommandArgs } from "../../commands/tunnelCommands";
import { TunnelTreeItem } from "../../views/tunnelTreeView";

suite("Tunnel commands", () => {
  test("generateDockerCompose/generateSystemService pass the tree item's id and name", () => {
    const item = new TunnelTreeItem("web-app", "0b1c2d3e-id", "stopped", "local", false);

    assert.deepStrictEqual(serviceCommandArgs(item, "docker"), ["0b1c2d3e-id", "web-app", "docker"]);
    assert.deepStrictEqual(serviceCommandArgs(item, "system"), ["0b1c2d3e-id", "web-app", "system"]);
  });

  test("without a tree item the service type is kept and the picker is used", () => {
    assert.deepStrictEqual(serviceCommandArgs(undefined, "docker"), [undefined, undefined, "docker"]);
  });
});
