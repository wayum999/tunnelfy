const path = require("path");
const fs = require("fs");
const rimraf = require("rimraf");
const { runTests } = require("@vscode/test-electron");

async function main() {
  try {
    // Create an extremely short path for the user data directory
    // Must be an absolute path and extremely short to avoid socket path length issues
    const tempDir = "/tmp/tf";

    // Clean up previous test data directory if it exists
    if (fs.existsSync(tempDir)) {
      console.log(`Cleaning up existing test directory: ${tempDir}`);
      rimraf.sync(tempDir);
    }

    // Create fresh directory
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Created test directory: ${tempDir}`);

    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, "../");

    // The path to test runner
    const extensionTestsPath = path.resolve(__dirname, "../out/test/test/suite/runPassingTests.js");

    console.log(`Using user data directory: ${tempDir}`);
    console.log(`Extension development path: ${extensionDevelopmentPath}`);
    console.log(`Extension tests path: ${extensionTestsPath}`);

    // Download VS Code, unzip it and run the integration test
    await runTests({
      // vscode version settings
      version: "1.98.2",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        "--disable-workspace-trust",
        "--force-disable-user-env",
        `--user-data-dir=${tempDir}`
      ],
    });

    console.log("Tests completed successfully");
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

main(); 