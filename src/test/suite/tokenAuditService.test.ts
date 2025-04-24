import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { TokenAuditService, TokenAuditEvent } from "../../services/tokenAuditService";
import { Logger, LogComponent } from "../../utils/logger";
import { TestExtensionContext } from "./testUtils";

suite("TokenAuditService Tests", () => {
  let mockExtensionContext: TestExtensionContext;
  let tokenAuditService: TokenAuditService;
  let mockSecrets: any;
  let mockLogger: any;
  let getInstanceStub: sinon.SinonStub;
  
  // Sample audit events for testing
  const sampleEvents: TokenAuditEvent[] = [
    {
      timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      action: "create",
      tunnelId: "tunnel-1",
      success: true
    },
    {
      timestamp: new Date(Date.now() - 1800000).toISOString(), // 30 mins ago
      action: "access",
      tunnelId: "tunnel-1",
      success: true
    },
    {
      timestamp: new Date(Date.now() - 600000).toISOString(), // 10 mins ago
      action: "access",
      tunnelId: "tunnel-2",
      success: false,
      error: "Token not found"
    },
    {
      timestamp: new Date(Date.now() - 300000).toISOString(), // 5 mins ago
      action: "delete",
      tunnelId: "tunnel-1",
      success: true
    }
  ];
  
  setup(() => {
    // Create mock extension context
    mockExtensionContext = new TestExtensionContext();
    
    // Mock secrets storage
    mockSecrets = {
      store: sinon.stub().resolves(),
      get: sinon.stub().resolves(null),
      delete: sinon.stub().resolves()
    };
    mockExtensionContext.secrets = mockSecrets;
    
    // Mock logger
    mockLogger = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    };
    getInstanceStub = sinon.stub(Logger, "getInstance").returns(mockLogger);
    
    // Create the token audit service
    tokenAuditService = new TokenAuditService(mockExtensionContext);
  });
  
  teardown(() => {
    sinon.restore();
  });
  
  test("loadAuditEvents should load events from secrets during initialization", async () => {
    // Set up secrets.get to return sample events - and make sure it returns them immediately
    mockSecrets.get.reset();
    mockSecrets.get.resolves(JSON.stringify(sampleEvents));
    
    // Create a new instance with our specially configured mocks
    const service = new TokenAuditService(mockExtensionContext);
    
    // Manually call the private loadAuditEvents method to ensure it runs
    // @ts-ignore - Accessing private method for testing
    await service.loadAuditEvents();
    
    // Verify the secret was accessed with the correct key
    assert.ok(
      mockSecrets.get.calledWith("tunnelfy.token.audit"),
      "Should access audit log with correct key"
    );
    
    // Verify events were loaded
    // @ts-ignore - Accessing private property for testing
    assert.strictEqual(service.auditEvents.length, sampleEvents.length, "Should load all events");
    
    // Verify events were loaded by checking the result of getAuditEvents
    const events = await service.getAuditEvents();
    assert.strictEqual(events.length, sampleEvents.length, "Should load all events");
  });
  
  test("loadAuditEvents should handle invalid JSON gracefully", async () => {
    // Set up secrets.get to return invalid JSON
    mockSecrets.get.reset();
    mockSecrets.get.resolves("invalid-json");
    
    // Create a new instance with our specially configured mocks
    const service = new TokenAuditService(mockExtensionContext);
    
    // Manually call the private loadAuditEvents method to ensure it runs
    // @ts-ignore - Accessing private method for testing
    await service.loadAuditEvents();
    
    // Verify error was logged
    assert.ok(
      mockLogger.error.calledWith(sinon.match.any, sinon.match(/Failed to parse audit events/)),
      "Should log error"
    );
    
    // Verify the error was handled gracefully
    const events = await service.getAuditEvents();
    assert.strictEqual(events.length, 0, "Should use empty array when JSON is invalid");
  });
  
  test("recordEvent should add events and save to secrets", async () => {
    // First load existing events (empty in this case)
    await tokenAuditService["loadAuditEvents"]();
    
    // Record a new event
    const newEvent = {
      action: "access" as const,
      tunnelId: "tunnel-test",
      success: true
    };
    
    await tokenAuditService.recordEvent(newEvent);
    
    // Verify the event was saved to secrets
    assert.ok(
      mockSecrets.store.calledWith(
        "tunnelfy.token.audit",
        sinon.match.string
      ),
      "Should store events in secrets"
    );
    
    // Verify the saved JSON contains the new event
    const savedJson = mockSecrets.store.firstCall.args[1];
    const savedEvents = JSON.parse(savedJson);
    assert.strictEqual(savedEvents.length, 1, "Should have saved one event");
    
    // Verify the event properties (excluding timestamp which is generated)
    assert.strictEqual(savedEvents[0].action, newEvent.action, "Action should match");
    assert.strictEqual(savedEvents[0].tunnelId, newEvent.tunnelId, "TunnelId should match");
    assert.strictEqual(savedEvents[0].success, newEvent.success, "Success should match");
    assert.ok(savedEvents[0].timestamp, "Timestamp should be generated");
  });
  
  test("recordEvent should log warnings for suspicious activity", async () => {
    // Record a failed event
    const failedEvent = {
      action: "access" as const,
      tunnelId: "tunnel-test",
      success: false,
      error: "Unauthorized access attempt"
    };
    
    await tokenAuditService.recordEvent(failedEvent);
    
    // Verify warning was logged
    assert.ok(mockLogger.warn.called, "Should log warning for failed event");
    assert.ok(
      mockLogger.warn.calledWith(
        LogComponent.TUNNEL,
        sinon.match.string,
        sinon.match.object
      ),
      "Should log with correct component and options"
    );
  });
  
  test("getAuditEvents should return all events when no tunnelId provided", async () => {
    // Set up sample events in the service
    // @ts-ignore - Access private property for testing
    tokenAuditService.auditEvents = [...sampleEvents];
    
    // Get all events
    const events = await tokenAuditService.getAuditEvents();
    
    // Verify all events are returned
    assert.strictEqual(events.length, sampleEvents.length, "Should return all events");
    assert.deepStrictEqual(events, sampleEvents, "Should return correct events");
  });
  
  test("getAuditEvents should filter events by tunnelId when provided", async () => {
    // Set up sample events in the service
    // @ts-ignore - Access private property for testing
    tokenAuditService.auditEvents = [...sampleEvents];
    
    // Get events for specific tunnel
    const tunnel1Events = await tokenAuditService.getAuditEvents("tunnel-1");
    
    // Verify filtered events
    assert.strictEqual(
      tunnel1Events.length, 
      sampleEvents.filter(e => e.tunnelId === "tunnel-1").length,
      "Should return only events for tunnel-1"
    );
    
    assert.ok(
      tunnel1Events.every(e => e.tunnelId === "tunnel-1"),
      "All returned events should be for tunnel-1"
    );
  });
  
  test("getFailedAttempts should return only failed events within time window", async () => {
    // Set up sample events in the service
    // @ts-ignore - Access private property for testing
    tokenAuditService.auditEvents = [...sampleEvents];
    
    // Get failed attempts within the last hour
    const failedAttempts = await tokenAuditService.getFailedAttempts(3600000);
    
    // Verify only failed events are returned
    assert.strictEqual(
      failedAttempts.length, 
      sampleEvents.filter(e => !e.success).length,
      "Should return only failed events"
    );
    
    assert.ok(
      failedAttempts.every(e => !e.success),
      "All returned events should be failures"
    );
    
    // Verify all events are within the time window (last hour)
    const oneHourAgo = Date.now() - 3600000;
    assert.ok(
      failedAttempts.every(e => new Date(e.timestamp).getTime() > oneHourAgo),
      "All events should be within time window"
    );
  });
  
  test("saveAuditEvents should limit the number of events to MAX_AUDIT_EVENTS", async () => {
    // Create many events (more than MAX_AUDIT_EVENTS)
    const maxEvents = 1000; // This should match TokenAuditService.MAX_AUDIT_EVENTS
    const manyEvents: TokenAuditEvent[] = [];
    
    for (let i = 0; i < maxEvents + 10; i++) {
      manyEvents.push({
        timestamp: new Date().toISOString(),
        action: "access",
        tunnelId: `tunnel-${i}`,
        success: true
      });
    }
    
    // Set up audit events
    // @ts-ignore - Access private property for testing
    tokenAuditService.auditEvents = [...manyEvents];
    
    // Save events
    await tokenAuditService["saveAuditEvents"]();
    
    // Verify events were trimmed to MAX_AUDIT_EVENTS
    const savedJson = mockSecrets.store.firstCall.args[1];
    const savedEvents = JSON.parse(savedJson);
    assert.strictEqual(savedEvents.length, maxEvents, `Should limit to ${maxEvents} events`);
    
    // Verify the most recent events were kept (last elements in the array)
    assert.deepStrictEqual(
      savedEvents,
      manyEvents.slice(-maxEvents),
      "Should keep the most recent events"
    );
  });
  
  test("saveAuditEvents should handle errors gracefully", async () => {
    // Set up secrets.store to throw an error
    mockSecrets.store.rejects(new Error("Storage error"));
    
    // Attempt to record an event (which will trigger saveAuditEvents)
    await tokenAuditService.recordEvent({
      action: "access",
      tunnelId: "tunnel-test",
      success: true
    });
    
    // Verify error was logged
    assert.ok(mockLogger.error.called, "Should log error");
    assert.ok(
      mockLogger.error.calledWith(
        LogComponent.TUNNEL,
        "Failed to save audit events:",
        sinon.match.string
      ),
      "Should log with correct message"
    );
  });
}); 