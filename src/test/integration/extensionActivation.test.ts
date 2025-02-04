import * as assert from 'assert';
import { activate } from '../../extension';
import { ProfileManager } from '../../services/profileManager';
import { createMockExtensionContext } from '../helpers/testHelper';

suite('Extension Activation Integration Tests', function() {
    this.beforeAll(() => {
        // Stub isCloudflaredInstalled to always return true to bypass install prompt
        ProfileManager.prototype.isCloudflaredInstalled = async function() { return true; };
    });

    test('activate should register subscriptions', async function() {
        const context = createMockExtensionContext();
        await activate(context as any);
        assert.ok(context.subscriptions.length > 0, 'Subscriptions should be registered after activation');
    });
}); 