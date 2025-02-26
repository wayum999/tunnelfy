import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Messages Test Suite', () => {
    test('Error Messages Format', () => {
        const errorMessages = {
            TUNNEL_CREATE_FAILED: 'Failed to create tunnel: {0}',
            TUNNEL_START_FAILED: 'Failed to start tunnel: {0}',
            INVALID_CONFIG: 'Invalid tunnel configuration: {0}'
        };

        // Test message formatting
        const error = 'test error';
        const formattedMessage = errorMessages.TUNNEL_CREATE_FAILED.replace('{0}', error);
        assert.strictEqual(formattedMessage, 'Failed to create tunnel: test error');
    });

    test('Success Messages Format', () => {
        const successMessages = {
            TUNNEL_CREATED: 'Tunnel {0} created successfully',
            TUNNEL_STARTED: 'Tunnel {0} started successfully',
            CONFIG_SAVED: 'Configuration saved successfully'
        };

        // Test message formatting
        const tunnelName = 'test-tunnel';
        const formattedMessage = successMessages.TUNNEL_CREATED.replace('{0}', tunnelName);
        assert.strictEqual(formattedMessage, 'Tunnel test-tunnel created successfully');
    });

    test('Info Messages Format', () => {
        const infoMessages = {
            TUNNEL_STARTING: 'Starting tunnel {0}...',
            TUNNEL_STOPPING: 'Stopping tunnel {0}...',
            LOADING_CONFIG: 'Loading configuration...'
        };

        // Test message formatting
        const tunnelName = 'test-tunnel';
        const formattedMessage = infoMessages.TUNNEL_STARTING.replace('{0}', tunnelName);
        assert.strictEqual(formattedMessage, 'Starting tunnel test-tunnel...');
    });
});
