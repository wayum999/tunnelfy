import * as path from "path";
import { runTests } from "@vscode/test-electron";
import * as fs from "fs";
import * as rimraf from "rimraf";

async function main() {
  try {
    // Create an extremely short path for the user data directory
    // The shorter this path, the less likely to hit socket length limits
    const tempDir = "/tmp/tf"; // extremely short path

    // Clean up previous test data directory if it exists
    if (fs.existsSync(tempDir)) {
      console.log(`Cleaning up existing test directory: ${tempDir}`);
      rimraf.sync(tempDir);
    }

    // Create fresh directory
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Created test directory: ${tempDir}`);

    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to test runner
    const extensionTestsPath = path.resolve(__dirname, "../../out/test/suite");

    // Download VS Code, unzip it and run the integration test
    await runTests({
      // vscode version settings
      version: '1.98.2', // Fix version to avoid download issues
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        "--disable-workspace-trust", // Disable workspace trust dialog
        "--force-disable-user-env", // Use clean environment
        `--user-data-dir=${tempDir}` // Use short path for user data
      ],
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

main();
