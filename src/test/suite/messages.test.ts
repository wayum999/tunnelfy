import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { Messages } from '../../utils/messages';

suite('Messages Test Suite', () => {
    let showInfoStub: sinon.SinonStub;
    let showWarningStub: sinon.SinonStub;
    let showErrorStub: sinon.SinonStub;

    setup(() => {
        // Stub VSCode window methods
        showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        showWarningStub = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
        showErrorStub = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    });

    teardown(() => {
        // Restore stubs
        sinon.restore();
    });

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

    test('Profile message strings are correctly formatted', () => {
        const profileName = 'test-profile';
        
        assert.strictEqual(
            Messages.PROFILE_CREATED(profileName),
            `Profile "${profileName}" created successfully`
        );
        
        assert.strictEqual(
            Messages.PROFILE_DELETED(profileName),
            `Profile "${profileName}" deleted successfully`
        );
        
        assert.strictEqual(
            Messages.PROFILE_API_KEY_UPDATED(profileName),
            `API key updated for profile "${profileName}"`
        );
        
        assert.strictEqual(
            Messages.PROFILE_SWITCHED(profileName),
            `Switched to profile "${profileName}"`
        );
    });

    test('Tunnel message strings are correctly formatted', () => {
        const tunnelName = 'test-tunnel';
        const hostname = 'example.com';
        const port = 8080;
        
        assert.strictEqual(
            Messages.TUNNEL_CREATED(tunnelName),
            `Tunnel "${tunnelName}" has been created.`
        );
        
        assert.strictEqual(
            Messages.TUNNEL_DELETED(tunnelName),
            `Tunnel "${tunnelName}" has been deleted.`
        );
        
        assert.strictEqual(
            Messages.TUNNEL_STARTED(tunnelName, hostname, port),
            `Tunnel "${tunnelName}" is now running at ${hostname} (port ${port}).`
        );
        
        assert.strictEqual(
            Messages.TUNNEL_STOPPED(tunnelName),
            `Tunnel "${tunnelName}" has been stopped.`
        );
    });

    test('Quick tunnel message strings are correctly formatted', () => {
        const tunnelName = 'test-quick-tunnel';
        const port = 8080;
        const url = 'https://example.com';
        
        // With name and port
        assert.strictEqual(
            Messages.QUICK_TUNNEL_STARTING(tunnelName, port),
            `Starting quick tunnel "${tunnelName}" on port ${port}...`
        );
        
        // Without name
        assert.strictEqual(
            Messages.QUICK_TUNNEL_STARTING(undefined, port),
            `Starting quick tunnel on port ${port}...`
        );
        
        // With name and port
        assert.strictEqual(
            Messages.QUICK_TUNNEL_CREATED(tunnelName, port),
            `Quick tunnel "${tunnelName}" created successfully on port ${port}`
        );
        
        // With name and url
        assert.strictEqual(
            Messages.QUICK_TUNNEL_RUNNING(url, tunnelName),
            `Quick tunnel "${tunnelName}" is running at ${url}`
        );
        
        // With just url
        assert.strictEqual(
            Messages.QUICK_TUNNEL_RUNNING(url),
            `Quick tunnel is running at ${url}`
        );
    });

    test('Error message objects are correctly formatted', () => {
        const error = new Error('Test error');
        
        // Test error object format
        const errorProfileObj = Messages.ERROR_CREATE_PROFILE(error);
        assert.strictEqual(errorProfileObj.message, 'Failed to create profile');
        assert.strictEqual(errorProfileObj.detail, error.toString());
        
        const errorTunnelObj = Messages.ERROR_CREATE_TUNNEL(error);
        assert.strictEqual(errorTunnelObj.message, 'Failed to create tunnel');
        assert.strictEqual(errorTunnelObj.detail, error.toString());
    });

    test('Service path messages are correctly formatted', () => {
        // Test docker compose generated with file path
        const filePath = '/path/to/docker-compose.yml';
        assert.strictEqual(
            Messages.DOCKER_COMPOSE_GENERATED(filePath),
            `Docker Compose and environment files generated at /path/to`
        );
        
        // Test docker compose generated with untitled files
        assert.strictEqual(
            Messages.DOCKER_COMPOSE_GENERATED('New untitled files'),
            'Docker Compose and environment files generated in new editors'
        );
        
        // Test system service generated
        const systemServiceResult = {
            type: 'workspace' as const,
            servicePath: '/path/to/service.service',
            envPath: '/path/to/.env'
        };
        
        assert.strictEqual(
            Messages.SYSTEM_SERVICE_GENERATED(systemServiceResult),
            `System service files have been created at:\n- ${systemServiceResult.servicePath}\n- ${systemServiceResult.envPath}`
        );
        
        // Test untitled system service
        const untitledSystemServiceResult = {
            type: 'untitled' as const
        };
        
        assert.strictEqual(
            Messages.SYSTEM_SERVICE_GENERATED(untitledSystemServiceResult),
            'System service files have been created as untitled files in the editor.'
        );
    });

    test('showInfo method calls vscode.window.showInformationMessage', async () => {
        const message = 'Test information message';
        await Messages.showInfo(message);
        
        sinon.assert.calledOnce(showInfoStub);
        sinon.assert.calledWith(showInfoStub, message);
    });

    test('showWarning method calls vscode.window.showWarningMessage', async () => {
        const message = 'Test warning message';
        const actionItem = 'Test Action';
        
        await Messages.showWarning(message, actionItem);
        
        sinon.assert.calledOnce(showWarningStub);
        sinon.assert.calledWith(showWarningStub, message, actionItem);
    });

    test('showError method calls vscode.window.showErrorMessage with string', async () => {
        const message = 'Test error message';
        const actionItem = 'Test Action';
        
        await Messages.showError(message, actionItem);
        
        sinon.assert.calledOnce(showErrorStub);
        sinon.assert.calledWith(showErrorStub, message, actionItem);
    });

    test('showError method calls vscode.window.showErrorMessage with object', async () => {
        const messageObj = { 
            message: 'Test error message', 
            detail: 'Test error details' 
        };
        const actionItem = 'Test Action';
        
        await Messages.showError(messageObj, actionItem);
        
        sinon.assert.calledOnce(showErrorStub);
        sinon.assert.calledWith(
            showErrorStub, 
            messageObj.message, 
            { detail: messageObj.detail }, 
            actionItem
        );
    });

    test('showModal method calls vscode.window.showWarningMessage with modal option', async () => {
        const message = 'Test modal message';
        const actionItem = 'Test Action';
        
        await Messages.showModal(message, actionItem);
        
        sinon.assert.calledOnce(showWarningStub);
        sinon.assert.calledWith(
            showWarningStub, 
            message, 
            { modal: true }, 
            actionItem
        );
    });

    test('showModal method calls vscode.window.showWarningMessage with object and modal option', async () => {
        const messageObj = { 
            message: 'Test modal message', 
            detail: 'Test modal details' 
        };
        const actionItem = 'Test Action';
        
        await Messages.showModal(messageObj, actionItem);
        
        sinon.assert.calledOnce(showWarningStub);
        sinon.assert.calledWith(
            showWarningStub, 
            messageObj.message, 
            { modal: true, detail: messageObj.detail }, 
            actionItem
        );
    });
});
