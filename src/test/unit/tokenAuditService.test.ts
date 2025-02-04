import * as assert from 'assert';
import * as vscode from 'vscode';
import { TokenAuditService } from '../../services/tokenAuditService';
import { before, after, describe, it } from 'mocha';
import * as sinon from 'sinon';

suite('TokenAuditService Test Suite', () => {
    let auditService: TokenAuditService;
    let mockContext: vscode.ExtensionContext;
    let mockSecrets: { [key: string]: string };
    let clock: sinon.SinonFakeTimers;

    setup(() => {
        // Mock VSCode extension context
        mockSecrets = {};
        mockContext = {
            secrets: {
                store: async (key: string, value: string) => { mockSecrets[key] = value; },
                get: async (key: string) => mockSecrets[key],
                delete: async (key: string) => { delete mockSecrets[key]; }
            },
            subscriptions: [],
            extensionPath: '/test/path'
        } as any;

        // Mock time for consistent timestamps
        clock = sinon.useFakeTimers();

        auditService = new TokenAuditService(mockContext);
    });

    teardown(() => {
        sinon.restore();
        clock.restore();
    });

    test('Record and retrieve audit events', async () => {
        const tunnelId = 'test-tunnel';
        const event = {
            action: 'create' as const,
            tunnelId,
            success: true
        };

        await auditService.recordEvent(event);
        const events = await auditService.getAuditEvents();

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].action, event.action);
        assert.strictEqual(events[0].tunnelId, event.tunnelId);
        assert.strictEqual(events[0].success, event.success);
        assert.ok(events[0].timestamp);
    });

    test('Filter events by tunnel ID', async () => {
        const tunnelId1 = 'tunnel-1';
        const tunnelId2 = 'tunnel-2';

        await auditService.recordEvent({
            action: 'create',
            tunnelId: tunnelId1,
            success: true
        });

        await auditService.recordEvent({
            action: 'create',
            tunnelId: tunnelId2,
            success: true
        });

        const events = await auditService.getAuditEvents(tunnelId1);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].tunnelId, tunnelId1);
    });

    test('Get failed attempts within time window', async () => {
        const tunnelId = 'test-tunnel';

        // Record a failed attempt
        await auditService.recordEvent({
            action: 'access',
            tunnelId,
            success: false,
            error: 'Test error'
        });

        // Advance time by 30 minutes
        clock.tick(30 * 60 * 1000);

        // Record another failed attempt
        await auditService.recordEvent({
            action: 'access',
            tunnelId,
            success: false,
            error: 'Test error'
        });

        // Get failed attempts in last hour
        const failedAttempts = await auditService.getFailedAttempts(60 * 60 * 1000);
        assert.strictEqual(failedAttempts.length, 2);

        // Get failed attempts in last 15 minutes
        const recentFailures = await auditService.getFailedAttempts(15 * 60 * 1000);
        assert.strictEqual(recentFailures.length, 1);
    });

    test('Limit maximum number of stored events', async () => {
        const tunnelId = 'test-tunnel';
        const maxEvents = 1000;

        // Record more than the maximum number of events
        for (let i = 0; i < maxEvents + 10; i++) {
            await auditService.recordEvent({
                action: 'access',
                tunnelId,
                success: true
            });
        }

        const events = await auditService.getAuditEvents();
        assert.strictEqual(events.length, maxEvents);
        
        // Verify we kept the most recent events
        const timestamps = events.map(e => new Date(e.timestamp).getTime());
        assert.ok(timestamps.every((t, i) => i === 0 || t >= timestamps[i - 1]));
    });
});
