# Tunnelfy Architecture Guide

This document provides a detailed overview of Tunnelfy's architecture to help developers understand how the different components work together.

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Extension Lifecycle](#extension-lifecycle)
- [Centralized Services](#centralized-services)
- [UI Components](#ui-components)
- [Command Structure](#command-structure)
- [File Structure](#file-structure)

## High-Level Architecture

Tunnelfy follows a layered architecture pattern:

```
+-------------+
|    Views    |   Tree views, WebViews, and UI components
+-------------+
|  Commands   |   Command handlers and user interactions
+-------------+
|  Services   |   Business logic and core functionality
+-------------+
|  Utilities  |   Helper functions and shared utilities
+-------------+
```

The extension is organized around:
1. **Services** that implement core functionality
2. **Commands** that expose functionality to the user
3. **Views** that provide the visual interface
4. **Utilities** that support the other layers

## Core Components

### TunnelManager

The `TunnelManager` class is the central component for tunnel operations. It:

- Manages tunnel creation and deletion
- Handles starting and stopping tunnels
- Tracks running tunnel processes
- Provides status information
- Emits events for UI updates

Key features:
- Process management for persistent and quick tunnels
- Event-based status updates
- Automatic cleanup of orphaned processes

### CloudflareApiService

The `CloudflareApiService` handles all interactions with the Cloudflare API:

- Creating and deleting tunnels
- Retrieving tunnel information
- Managing DNS records
- Handling authentication

### ProfileManager

The `ProfileManager` manages Cloudflare profiles:

- Storing and retrieving profile information
- Switching between profiles
- Managing API keys and tokens
- Profile-specific settings

### Logger

The centralized `Logger` handles all logging:

- Component-based logging
- Multiple output channels
- Log rotation and management
- Different log levels

### Messages

The `Messages` class centralizes all user-facing messages:

- Static message definitions
- Parameterized messages
- Consistent formatting
- Helper methods for showing messages

## Data Flow

A typical operation flow:

1. **User Action** (e.g., clicking a button)
2. **Command Handler** processes the action
3. **Service Method** implements the business logic
4. **Events** are emitted for status changes
5. **View Updates** reflect the changes in the UI

Example: Creating a tunnel

```
User clicks "Create Tunnel"
    ↓
tunnelCommands.ts registers and handles the command
    ↓
TunnelManager.createTunnel() implements the logic
    ↓
CloudflareApiService.createTunnel() calls the API
    ↓
TunnelManager emits events
    ↓
TunnelTreeDataProvider updates the UI
```

## Extension Lifecycle

### Activation

In `extension.ts`, the `activate` function:

1. Initializes all services
2. Creates UI components
3. Registers commands
4. Sets up event handlers
5. Restores previous state

### Deactivation

The `deactivate` function:

1. Cleans up resources
2. Stops running processes
3. Closes connections
4. Saves state

## Centralized Services

Tunnelfy uses dependency injection to provide services throughout the extension:

```typescript
// Service initialization in extension.ts
const logger = new Logger(context);
const cloudflareApiService = new CloudflareApiService(logger);
const profileManager = new ProfileManager(context, logger);
const tunnelManager = new TunnelManager(
  context,
  logger,
  cloudflareApiService,
  profileManager
);

// Service usage in commands
registerTunnelCommands(
  context,
  tunnelManager,
  cloudflareApiService,
  tokenService,
  profileManager,
  tunnelProvider,
  serviceGenerator
);
```

## UI Components

### Tree Views

Tunnelfy uses Tree Views as the primary UI component:

1. **TunnelTreeView** - Shows persistent tunnels
2. **QuickTunnelTreeView** - Shows temporary tunnels
3. **ProfileTreeView** - Shows Cloudflare profiles

Tree items represent entities with:
- Visual status indicators
- Context menu actions
- Click handlers
- Tooltip information

### UI Updates

UI components are updated using the Observer pattern:

1. Services emit events when state changes
2. Tree data providers listen for events
3. The `refresh()` method is called to update views
4. VS Code redraws the UI

## Command Structure

Commands follow a consistent pattern:

```typescript
vscode.commands.registerCommand("tunnelfy.commandName", async () => {
  try {
    // 1. Get input from user if needed
    const input = await vscode.window.showInputBox({...});
    
    // 2. Call service method
    const result = await service.method(input);
    
    // 3. Show result to user
    await Messages.showInfo(Messages.SUCCESS_MESSAGE(result));
  } catch (error) {
    // 4. Handle errors
    logger.error(LogComponent.COMMAND, `Error: ${error}`);
    await Messages.showError(Messages.ERROR_MESSAGE(error));
  }
});
```

Command categories:
1. **Tunnel Commands** - Managing permanent tunnels
2. **Quick Tunnel Commands** - Managing temporary tunnels
3. **Profile Commands** - Managing Cloudflare profiles
4. **Service Generation Commands** - Creating Docker/system service files

## File Structure

The complete file structure with descriptions:

```
src/
├── commands/                    # Command implementations
│   ├── profileCommands.ts       # Profile management commands
│   ├── quickTunnelCommands.ts   # Quick tunnel commands
│   └── tunnelCommands.ts        # Permanent tunnel commands
├── services/                    # Core business logic
│   ├── cloudflareApi/           # Cloudflare API integration
│   │   ├── index.ts             # Main API service
│   │   └── types.ts             # API type definitions
│   ├── cloudflared/             # Cloudflared CLI integration
│   │   ├── TunnelManager.ts     # Main tunnel management
│   │   ├── TunnelConfig.ts      # Tunnel configuration
│   │   └── TunnelLogger.ts      # Tunnel-specific logging
│   ├── dockerComposeGenerator.ts # Docker config generation
│   ├── profileManager.ts        # Profile management
│   ├── serviceGenerator.ts      # Service generation interface
│   ├── systemServiceGenerator.ts # System service generation
│   └── tokenService.ts          # Secure token handling
├── test/                        # Test files
├── types/                       # Type definitions
├── utils/                       # Utility functions
│   ├── cloudflaredUtils.ts      # Cloudflared helpers
│   ├── logger.ts                # Logging system
│   └── messages.ts              # Centralized user messages
├── views/                       # UI components
│   ├── profileTreeView.ts       # Profile UI
│   ├── quickTunnelTreeView.ts   # Quick tunnel UI
│   └── tunnelTreeView.ts        # Permanent tunnel UI
└── extension.ts                 # Main entry point
```

## Adding New Components

When adding new functionality:

1. Determine which layer it belongs to
2. Add service methods first
3. Create or update commands
4. Update UI components if needed
5. Add appropriate events
6. Update documentation

## Application State

Tunnelfy manages state in several ways:

1. **VS Code Extension Context** for persistent storage
2. **In-memory state** for runtime information
3. **Configuration files** for tunnel settings
4. **Global state** for user settings

Each component is responsible for managing its own state and providing appropriate access methods. 