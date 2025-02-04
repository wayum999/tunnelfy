import * as path from 'path';
import * as process from 'process';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // Use the symbolic link path
        const testRoot = '/tmp/vsc-test';
        const extensionDevelopmentPath = path.join(testRoot, 'ext');
        const extensionTestsPath = path.join(extensionDevelopmentPath, 'out/test/suite/index');
        
        // Set up test environment paths
        const testDataDir = path.join(testRoot, 'data');
        const testExtDir = path.join(testRoot, 'extensions');
        
        // Create required directories
        fs.mkdirSync(testDataDir, { recursive: true });
        fs.mkdirSync(testExtDir, { recursive: true });

        // Run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                '--disable-extensions',
                `--user-data-dir=${testDataDir}`,
                `--extensions-dir=${testExtDir}`,
                '--disable-telemetry',
                '--skip-welcome',
                '--skip-release-notes'
            ]
        });
    } catch (err) {
        console.error('Failed to run tests:', err);
        process.exit(1);
    }
}

main();
