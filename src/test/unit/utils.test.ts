import * as assert from 'assert';
import { createMockExtensionContext } from '../helpers/testHelper';
import { ExtensionMode } from '../mocks/vscode';

describe('Basic Utility Tests', () => {
    // This test verifies that our test environment is working
    it('Test environment setup', () => {
        const context = createMockExtensionContext();
        assert.ok(context, 'Extension context should be created');
        assert.ok(context.extensionPath, 'Extension path should be defined');
        assert.strictEqual(context.extensionMode, ExtensionMode.Test, 'Extension mode should be Test');
    });
});
