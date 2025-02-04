import * as assert from 'assert';
import * as vscode from 'vscode';
import { TokenService } from '../../services/tokenService';
import { TokenAuditService } from '../../services/tokenAuditService';
import { before, after, describe, it } from 'mocha';
import * as sinon from 'sinon';

suite('TokenService Test Suite', () => {
    let tokenService: TokenService;
    let mockContext: vscode.ExtensionContext;
    let mockSecrets: { [key: string]: string };
    let mockClipboard: { text: string };
    let clock: sinon.SinonFakeTimers;

    setup(() => {
        // Mock VSCode extension context
        mockSecrets = {};
        mockClipboard = { text: '' };
        mockContext = {
            secrets: {
                store: async (key: string, value: string) => { mockSecrets[key] = value; },
                get: async (key: string) => mockSecrets[key],
                delete: async (key: string) => { delete mockSecrets[key]; }
            },
            subscriptions: [],
            extensionPath: '/test/path'
        } as any;

        // Mock VSCode clipboard
        const mockEnv = {
            clipboard: {
                writeText: async (text: string) => { mockClipboard.text = text; },
                readText: async () => mockClipboard.text
            }
        };
        sinon.replace(vscode, 'env', mockEnv as any);

        // Mock time for testing auto-clear
        clock = sinon.useFakeTimers();

        tokenService = new TokenService(mockContext);
    });

    teardown(() => {
        sinon.restore();
        clock.restore();
    });

    test('Store and retrieve token', async () => {
        const tunnelId = 'test-tunnel';
        const token = 'test-token';

        await tokenService.storeTunnelToken(tunnelId, token);
        const retrievedToken = await tokenService.getTunnelToken(tunnelId);

        assert.strictEqual(retrievedToken, token);
    });

    test('Delete token', async () => {
        const tunnelId = 'test-tunnel';
        const token = 'test-token';

        await tokenService.storeTunnelToken(tunnelId, token);
        await tokenService.deleteTunnelToken(tunnelId);
        const retrievedToken = await tokenService.getTunnelToken(tunnelId);

        assert.strictEqual(retrievedToken, undefined);
    });

    test('Copy token to clipboard with auto-clear', async () => {
        const token = 'test-token';
        
        // Mock user confirming the warning
        const showWarningMessage = sinon.stub(vscode.window, 'showWarningMessage')
            .resolves('Continue' as any);

        const disposable = await tokenService.copyTokenToClipboard(token);
        
        // Check token is in clipboard
        assert.strictEqual(mockClipboard.text, token);

        // Advance time by 29 seconds
        clock.tick(29000);
        assert.strictEqual(mockClipboard.text, token);

        // Advance time to trigger auto-clear
        clock.tick(1000);
        await clock.runAllAsync();
        assert.strictEqual(mockClipboard.text, '');

        disposable.dispose();
    });

    test('Rate limiting after failed attempts', async () => {
        const tunnelId = 'test-tunnel';
        
        // Simulate 5 failed attempts
        for (let i = 0; i < 5; i++) {
            try {
                await tokenService.getTunnelToken('non-existent');
            } catch (error) {
                // Expected error
            }
        }

        // The 6th attempt should be blocked
        await assert.rejects(
            tokenService.getTunnelToken(tunnelId),
            /Too many failed attempts/
        );
    });

    test('Memory encryption', async () => {
        const tunnelId = 'test-tunnel';
        const token = 'test-token';

        await tokenService.storeTunnelToken(tunnelId, token);

        // Check that the token is not stored in plain text in memory
        const encryptedTokens = (tokenService as any).encryptedTokens;
        const memoryToken = encryptedTokens.get(tunnelId);

        assert.ok(memoryToken, 'Token should be stored in memory');
        assert.ok(memoryToken.encrypted, 'Token should be encrypted');
        assert.ok(memoryToken.iv, 'Token should have an IV');
        assert.ok(memoryToken.authTag, 'Token should have an auth tag');
        assert.notStrictEqual(memoryToken.encrypted.toString(), token, 'Token should not be stored as plain text');

        // But we should still be able to retrieve it
        const retrievedToken = await tokenService.getTunnelToken(tunnelId);
        assert.strictEqual(retrievedToken, token);
    });
});
