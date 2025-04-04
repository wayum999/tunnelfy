import { defineConfig } from '@vscode/test-cli';

/**
 * Configuration for VSCode test runner
 */
export default defineConfig({
	files: 'out/test/**/*.test.js',
	launchArgs: [
		"--disable-workspace-trust",
		"--force-disable-user-env",
		"--user-data-dir=/tmp/tf"
	]
});
