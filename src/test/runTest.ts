import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to test runner
        const extensionTestsPath = path.resolve(__dirname, '../../out/test/suite');

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                '--disable-extensions', // Disable other extensions
                '--disable-gpu',       // Disable GPU hardware acceleration
                '--disable-workspace-trust' // Disable workspace trust dialog
            ]
        });
    } catch (err) {
        console.error('Failed to run tests:', err);
        process.exit(1);
    }
}

main();
