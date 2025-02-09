import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { TunnelLogger } from '../../services/cloudflared/TunnelLogger';
import { Logger, LogComponent } from '../../utils/logger';

suite('TunnelLogger Test Suite', () => {
    let tunnelLogger: TunnelLogger;
    let testWorkspaceDir: string;
    let logDir: string;
    let loggedMessages: Array<{ level: string; component: LogComponent; message: string }>;

    const mockLogger: Logger = {
        info: (component: LogComponent, message: string) => {
            loggedMessages.push({ level: 'info', component, message });
        },
        error: (component: LogComponent, message: string) => {
            loggedMessages.push({ level: 'error', component, message });
        },
        debug: (component: LogComponent, message: string) => {
            loggedMessages.push({ level: 'debug', component, message });
        },
        warn: (component: LogComponent, message: string) => {
            loggedMessages.push({ level: 'warn', component, message });
        }
    } as unknown as Logger;

    setup(() => {
        testWorkspaceDir = path.join(__dirname, 'test-workspace');
        logDir = path.join(testWorkspaceDir, 'logs', 'tunnels');
        loggedMessages = [];
        tunnelLogger = new TunnelLogger(mockLogger, testWorkspaceDir);
    });

    teardown(() => {
        if (fs.existsSync(testWorkspaceDir)) {
            fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
        }
    });

    test('should create log directory if it does not exist', () => {
        assert.strictEqual(fs.existsSync(logDir), true);
    });

    test('should create log stream for tunnel', () => {
        const tunnelId = 'test-tunnel';
        const stream = tunnelLogger.createLogStream(tunnelId);
        assert.strictEqual(stream instanceof fs.WriteStream, true);
        stream.end();
    });

    test('should log tunnel events', async () => {
        const tunnelId = 'test-tunnel';
        const event = 'started';
        const details = { port: 8080 };

        await tunnelLogger.logTunnelEvent(tunnelId, event, details);

        assert.strictEqual(loggedMessages.length, 1);
        assert.strictEqual(loggedMessages[0].level, 'info');
        assert.strictEqual(loggedMessages[0].component, LogComponent.TUNNEL);
        assert.ok(loggedMessages[0].message.includes(tunnelId));
        assert.ok(loggedMessages[0].message.includes(event));
        assert.ok(loggedMessages[0].message.includes(JSON.stringify(details)));
    });

    test('should rotate logs when file size exceeds limit', async () => {
        const tunnelId = 'test-tunnel';
        const logFile = path.join(logDir, `${tunnelId}.log`);
        const stream = tunnelLogger.createLogStream(tunnelId);

        // Write data larger than the rotation threshold (10MB in TunnelLogger)
        const largeData = Buffer.alloc(11 * 1024 * 1024, 'x');
        stream.write(largeData);
        stream.end();

        // Trigger log rotation by logging an event
        await tunnelLogger.logTunnelEvent(tunnelId, 'test event');

        // Check if the original log file was rotated
        const rotatedFile = path.join(logDir, `${tunnelId}.1.log`);
        assert.strictEqual(fs.existsSync(rotatedFile), true);
        assert.strictEqual(fs.existsSync(logFile), true);

        // New log file should be empty or contain only the new event
        const newFileStats = fs.statSync(logFile);
        assert.ok(newFileStats.size < largeData.length);
    });

    test('should clean up old logs', async () => {
        const tunnelId = 'test-tunnel';
        const logFile = path.join(logDir, `${tunnelId}.log`);

        // Create a log file
        const stream = tunnelLogger.createLogStream(tunnelId);
        stream.write('test log data');
        stream.end();

        // Modify the file time to be older than 7 days
        const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        fs.utimesSync(logFile, oldTime, oldTime);

        await tunnelLogger.cleanupOldLogs();

        assert.strictEqual(fs.existsSync(logFile), false);
        assert.ok(loggedMessages.some(msg => 
            msg.level === 'info' && 
            msg.message.includes('Deleted old log file') &&
            msg.message.includes(tunnelId)
        ));
    });

    test('should handle errors during log operations', async () => {
        const tunnelId = 'test-tunnel';
        const logFile = path.join(logDir, `${tunnelId}.log`);

        // Create a log file and make it read-only
        const stream = tunnelLogger.createLogStream(tunnelId);
        stream.end();
        fs.chmodSync(logFile, 0o444);

        // Attempt to write to the read-only file
        await tunnelLogger.logTunnelEvent(tunnelId, 'test event');

        assert.ok(loggedMessages.some(msg => 
            msg.level === 'error' && 
            msg.message.includes('Error')
        ));
    });
}); 