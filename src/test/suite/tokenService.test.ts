import * as assert from 'assert';
import * as vscode from 'vscode';
import { TokenService } from '../../services/tokenService';
import { beforeEach, afterEach, describe, it } from 'mocha';
import { TestExtensionContext } from './testUtils';

suite('TokenService Test Suite', () => {
    let tokenService: TokenService;
    let context: vscode.ExtensionContext;

    setup(async () => {
        // Create a test extension context
        context = new TestExtensionContext();
        tokenService = new TokenService(context);
    });

    teardown(async () => {
        // Clean up any stored tokens
        const secrets = await context.secrets.get('tunnelfy.tunnel.token.');
        if (secrets) {
            await context.secrets.delete('tunnelfy.tunnel.token.');
        }
    });

    test('should store and retrieve a tunnel token successfully', async () => {
        const tunnelId = 'test-tunnel-id';
        const token = 'test-token-value';

        // Store the token
        await tokenService.storeTunnelToken(tunnelId, token);

        // Retrieve the token
        const retrievedToken = await tokenService.getTunnelToken(tunnelId);
        assert.strictEqual(retrievedToken, token);
    });

    test('should delete a tunnel token successfully', async () => {
        const tunnelId = 'test-tunnel-id';
        const token = 'test-token-value';

        // Store and then delete the token
        await tokenService.storeTunnelToken(tunnelId, token);
        await tokenService.deleteTunnelToken(tunnelId);

        // Attempt to retrieve the deleted token
        const retrievedToken = await tokenService.getTunnelToken(tunnelId);
        assert.strictEqual(retrievedToken, undefined);
    });

    test('should handle non-existent tunnel token retrieval', async () => {
        const tunnelId = 'non-existent-tunnel';
        const retrievedToken = await tokenService.getTunnelToken(tunnelId);
        assert.strictEqual(retrievedToken, undefined);
    });

    test('should handle rate limiting after multiple failed attempts', async () => {
        const tunnelId = 'test-tunnel';
        const maxAttempts = 3;

        // Override the rate limiting timeout for testing
        const originalTimeout = (TokenService as any).FAILED_ATTEMPTS_TIMEOUT_MS;
        (TokenService as any).FAILED_ATTEMPTS_TIMEOUT_MS = 100; // 100ms for testing

        // Make multiple failed attempts
        for (let i = 0; i < maxAttempts + 1; i++) {
            try {
                await tokenService.getTunnelToken(tunnelId);
            } catch (error) {
                // Expected to fail
            }
        }

        // Verify rate limiting is triggered
        try {
            await tokenService.getTunnelToken(tunnelId);
            assert.fail('Expected rate limiting to be triggered');
        } catch (error: any) {
            assert.match(error.message, /Too many failed attempts. Please try again in \d+ minutes./);
        }

        // Wait for rate limiting to reset
        await new Promise(resolve => setTimeout(resolve, 150)); // Wait longer than the timeout

        // Verify rate limiting is reset
        const token = await tokenService.getTunnelToken(tunnelId);
        assert.strictEqual(token, undefined); // Since we're not actually storing a token

        // Restore original timeout
        (TokenService as any).FAILED_ATTEMPTS_TIMEOUT_MS = originalTimeout;
    });
}); 