# Tunnelfy Best Practices

This document outlines best practices for working with the Tunnelfy codebase to maintain consistency, quality, and reliability.

## Table of Contents

- [Code Organization](#code-organization)
- [Error Handling](#error-handling)
- [Logging](#logging)
- [Messaging](#messaging)
- [UI Components](#ui-components)
- [Testing](#testing)
- [Performance](#performance)
- [Security](#security)

## Code Organization

### File Structure

- Keep files focused on a single responsibility
- Limit file size to around 500 lines
- Group related functionality in the same directory
- Use consistent naming conventions

### Import Order

```typescript
// 1. Node.js built-in modules
import * as fs from 'fs';
import * as path from 'path';

// 2. VS Code API
import * as vscode from 'vscode';

// 3. Third-party libraries
import * as yaml from 'js-yaml';

// 4. Project imports
import { Logger, LogComponent } from '../../utils/logger';
import { TunnelManager } from '../cloudflared';
```

### Service Organization

- Keep service methods small and focused
- Use dependency injection for services
- Export interfaces and types

Example:

```typescript
// Good practice
export class ServiceA {
  constructor(
    private readonly logger: Logger,
    private readonly dependencyB: ServiceB,
  ) {}
  
  async doSomething(): Promise<Result> {
    // Implementation
  }
}

// Usage
const serviceA = new ServiceA(logger, serviceB);
```

## Error Handling

### Command Error Handling Pattern

Always wrap command implementations in try/catch blocks:

```typescript
vscode.commands.registerCommand("tunnelfy.commandName", async () => {
  try {
    // Implementation
  } catch (error) {
    logger.error(LogComponent.COMMAND, "Error in command", error);
    Messages.showError(Messages.ERROR_COMMAND(error));
  }
});
```

### Service Error Handling Pattern

```typescript
async methodName(): Promise<Result> {
  try {
    // Implementation
  } catch (error) {
    this.logger.error(LogComponent.SERVICE, `Error in methodName: ${error}`);
    throw error; // Re-throw for commands to handle
  }
}
```

### Error Translation

Convert technical errors to user-friendly messages:

```typescript
try {
  // Implementation
} catch (error) {
  if (error.code === 'ENOENT') {
    throw new Error('Configuration file not found. Please run setup first.');
  }
  throw error;
}
```

## Logging

### Log Levels

- **Debug**: Detailed information for debugging
- **Info**: General information about operation progress
- **Warning**: Potential issues that don't prevent operation
- **Error**: Failures that prevent an operation from succeeding

### Logging Pattern

```typescript
// Debug message with object
this.logger.debug(LogComponent.TUNNEL, "Tunnel configuration", config);

// Info message
this.logger.info(LogComponent.TUNNEL, `Created tunnel: ${name} (${tunnel.id})`);

// Warning message
this.logger.warn(
  LogComponent.TUNNEL,
  `No running tunnel found for ID: ${tunnelId}`,
  { preserveFocus: true }
);

// Error message
this.logger.error(
  LogComponent.TUNNEL,
  `Failed to create tunnel: ${error}`,
  error
);
```

### What to Log

- Service method entry and exit points
- Key decision points
- Error conditions
- User actions
- Performance-sensitive operations
- Process starts and stops

## Messaging

### Message Organization

Group related messages together in the `Messages` class:

```typescript
// Tunnel-related messages
static readonly TUNNEL_CREATED = (name: string) =>
  `Tunnel "${name}" has been created.`;
static readonly TUNNEL_DELETED = (name: string) =>
  `Tunnel "${name}" has been deleted.`;
static readonly TUNNEL_STARTED = (name: string, hostname: string, targetUrlOrPort: string | number) => {
  // Message implementation
};

// Error messages
static readonly ERROR_CREATE_TUNNEL = (error: any) => ({
  message: "Failed to create tunnel",
  detail: String(error),
});
```

### Message Usage

```typescript
// Information message
await Messages.showInfo(Messages.TUNNEL_CREATED(tunnel.name));

// Error message
await Messages.showError(Messages.ERROR_CREATE_TUNNEL(error));

// Modal confirmation
const confirm = await Messages.showModal(
  `Are you sure you want to delete tunnel '${item.label}'?`,
  "Delete",
);
```

### Adding New Messages

When adding new functionality, always add corresponding messages to the `Messages` class:

```typescript
// In messages.ts
static readonly NEW_FEATURE_SUCCESS = (param: string) =>
  `Operation succeeded with ${param}`;

// In your code
Messages.showInfo(Messages.NEW_FEATURE_SUCCESS(result));
```

## UI Components

### TreeView Pattern

```typescript
export class CustomTreeItem extends vscode.TreeItem {
  constructor(
    public readonly id: string,
    public readonly label: string,
  ) {
    super(label);
    
    // Set appearance
    this.iconPath = new vscode.ThemeIcon("circuit-board");
    this.tooltip = "Tooltip text";
    this.description = "Description text";
    
    // Set behavior
    this.contextValue = "itemType"; // For context menu filtering
    this.command = {
      command: "tunnelfy.commandName",
      title: "Action Title",
      arguments: [this],
    };
  }
}

export class CustomTreeDataProvider implements vscode.TreeDataProvider<CustomTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CustomTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  
  getTreeItem(element: CustomTreeItem): vscode.TreeItem {
    return element;
  }
  
  async getChildren(element?: CustomTreeItem): Promise<CustomTreeItem[]> {
    // Return tree items
  }
}
```

### UI Update Pattern

```typescript
// Service emits events
this._onTunnelEvent.fire({
  type: "start",
  tunnelId,
  message: `Tunnel started for ${targetUrl}`,
});

// TreeDataProvider listens for events
tunnelManager.onTunnelEvent((event: TunnelEvent) => {
  if (event.type === "start" || event.type === "stop") {
    this.refresh();
  }
});
```

## Testing

### Unit Test Pattern

```typescript
suite("ServiceName", () => {
  let service: ServiceName;
  let mockDependency: sinon.SinonStubbedInstance<Dependency>;
  
  setup(() => {
    mockDependency = sinon.createStubInstance(Dependency);
    service = new ServiceName(mockDependency);
  });
  
  test("should do something", async () => {
    // Arrange
    mockDependency.method.resolves("result");
    
    // Act
    const result = await service.methodToTest();
    
    // Assert
    assert.strictEqual(result, "expected");
    assert.strictEqual(mockDependency.method.callCount, 1);
  });
  
  test("should handle errors", async () => {
    // Arrange
    mockDependency.method.rejects(new Error("test error"));
    
    // Act & Assert
    await assert.rejects(
      service.methodToTest(),
      /test error/
    );
  });
});
```

### Integration Test Pattern

```typescript
suite("Integration: Feature", () => {
  suiteSetup(async () => {
    // Setup before all tests
  });
  
  setup(async () => {
    // Setup before each test
  });
  
  test("should complete end-to-end flow", async () => {
    // Test full flow
  });
  
  suiteTeardown(async () => {
    // Cleanup after all tests
  });
});
```

## Performance

### Async/Await Pattern

```typescript
// Good practice
async methodName(): Promise<Result> {
  const result = await this.asyncOperation();
  return this.processResult(result);
}

// Avoid
methodName(): Promise<Result> {
  return this.asyncOperation()
    .then(result => this.processResult(result));
}
```

### Resource Cleanup

```typescript
// Ensure resources are always cleaned up
try {
  const resource = await this.acquireResource();
  // Use resource
} catch (error) {
  // Handle error
} finally {
  await this.releaseResource();
}
```

### Caching

```typescript
private cachedData: Map<string, { data: any, timestamp: number }> = new Map();
private readonly CACHE_TTL = 60 * 1000; // 1 minute

async getData(key: string): Promise<any> {
  const cached = this.cachedData.get(key);
  const now = Date.now();
  
  if (cached && now - cached.timestamp < this.CACHE_TTL) {
    return cached.data;
  }
  
  const data = await this.fetchData(key);
  this.cachedData.set(key, { data, timestamp: now });
  return data;
}
```

## Security

### Token Handling

```typescript
// Good practice - use TokenService
const token = await tokenService.getTunnelToken(tunnelId);

// Avoid
const token = this.tokens.get(tunnelId); // Insecure
```

### Clipboard Security

```typescript
// Good practice - secure clipboard handling
const disposable = await tokenService.copyTokenToClipboard(token);
context.subscriptions.push(disposable);

// Avoid
await vscode.env.clipboard.writeText(token); // No auto-clearing
```

### User Confirmation for Sensitive Operations

```typescript
const confirm = await Messages.showModal(
  `Are you sure you want to delete tunnel '${name}'?`,
  "Delete",
);

if (confirm === "Delete") {
  // Proceed with operation
}
```

## Documentation

### Code Comments

```typescript
/**
 * Creates a new tunnel with the given name
 * @param name Name for the new tunnel
 * @param managementType How the tunnel will be managed ('local' or 'remote')
 * @returns Created tunnel information
 * @throws Error if creation fails
 */
async createTunnel(name: string, managementType: 'local' | 'remote' = 'local'): Promise<ApiTunnel> {
  // Implementation
}
```

### Implementation Comments

```typescript
// Parse port or URL
let port: number;
let targetUrl: string;

if (typeof portOrUrl === 'number') {
  // For backward compatibility - if a number is passed, assume it's localhost
  port = portOrUrl;
  targetUrl = `http://localhost:${port}`;
} else {
  // Try to parse as URL
  // ...
}