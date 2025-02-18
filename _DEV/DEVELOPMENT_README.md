# Cloudflare VS Code Extension Development Notes

## Table of Contents
- [Project Architecture](#project-architecture)
  - [Core Components](#core-components)
  - [Process Architecture](#process-architecture)
  - [UI Architecture](#ui-architecture)
  - [Logging Architecture](#logging-architecture)
  - [Tunnel Management](#tunnel-management)
  - [Security Architecture](#security-architecture)
  - [Docker Compose Generation](#docker-compose-generation)
- [Development Workflow](#development-workflow)
  - [Setting Up Development Environment](#setting-up-development-environment)
  - [Making Changes](#making-changes)
  - [Testing](#testing)
- [Testing Guide](#testing-guide)
  - [Test Setup Overview](#test-setup-overview)
  - [Directory Structure](#directory-structure)
  - [Running Tests](#running-tests)
  - [Writing Tests](#writing-tests)
  - [Test Configuration](#test-configuration)
  - [Debugging Tests](#debugging-tests)
  - [Common Issues and Solutions](#common-issues-and-solutions)
  - [Adding New Tests](#adding-new-tests)
- [Security Development Guidelines](#security-development-guidelines)
  - [Token Handling](#token-handling)
  - [Clipboard Operations](#clipboard-operations)
  - [Audit Logging](#audit-logging)
- [Key Files and Their Purposes](#key-files-and-their-purposes)
- [Common Development Tasks](#common-development-tasks)
  - [Adding a New Command](#adding-a-new-command)
  - [Git Workflow](#git-workflow)
  - [Adding New Logging Component](#adding-new-logging-component)
  - [Modifying Tunnel Behavior](#modifying-tunnel-behavior)
- [Troubleshooting Development](#troubleshooting-development)
  - [Common Issues](#common-issues)
  - [Debugging Tips](#debugging-tips)
- [Best Practices](#best-practices)
  - [Logging](#logging)
  - [Error Handling](#error-handling)
  - [Code Organization](#code-organization)
  - [Testing](#testing-1)
- [Additional Resources](#additional-resources)

## Project Architecture

### Core Components

1. **Extension Entry Point** (`src/extension.ts`)
   - Initializes services and providers
   - Registers commands and views
   - Manages extension lifecycle
   - Handles tunnel process lifecycle

2. **Services Layer** (`src/services/`)
   - `cloudflaredService.ts`: Interfaces with cloudflared CLI
     - Manages tunnel processes in detached mode
     - Handles process cleanup and recovery
     - Provides tunnel status monitoring
   - `profileManager.ts`: Manages Cloudflare profiles
   - `loggingService.ts`: Handles logging across components
   - `tokenService.ts`: Manages secure token handling and storage
   - `tokenAuditService.ts`: Tracks and audits token operations
   - `dockerComposeGenerator.ts`: Generates Docker configurations
     - Creates Docker Compose files for tunnels
     - Manages environment files for tokens
     - Provides Docker networking guidance

3. **Views Layer** (`src/views/`)
   - `tunnelTreeView.ts`: TreeView for tunnel management
     - Displays tunnel status with visual indicators
     - Provides hover-based tunnel controls
     - Handles tunnel selection and actions
     - Includes Docker Compose generation button
   - `profilesView.ts`: UI for profile management

4. **Commands Layer** (`src/commands/`)
   - Implements all VS Code commands
   - Handles user interactions
   - Integrates services with UI
   - Manages tunnel lifecycle commands

### Process Architecture

The extension implements a robust process management system for tunnels:

1. **Tunnel Process Management**
   ```
   User Action
        ↓
   Command Handler
        ↓
   CloudflaredService
        ↓
   Detached Process
   ```

2. **Process Features**
   - Detached mode operation
   - Automatic cleanup on shutdown
   - Status monitoring and updates
   - Error handling and recovery

### Logging Architecture

The logging system is built around component-based logging with file rotation:

```
~/.vscode/extensions/cloudflare-tunnel/logs/
├── extension.log       # Extension lifecycle events
├── tunnel.log         # Tunnel operations
├── command.log        # Command executions
└── quick_tunnel.log   # Quick tunnel operations
```

Each log type includes:
- Timestamp
- Log level (DEBUG, INFO, WARN, ERROR)
- Component identifier
- Message
- Context data (when relevant)

### UI Architecture

The extension's UI is built around TreeViews with enhanced functionality:

1. **Tunnel TreeView**
   - Status Indicators
     - Green circle: Active tunnel
     - Outline circle: Inactive tunnel
   - Hover Actions
     - Start tunnel button
     - Stop tunnel button
   - Context Menu
     - Copy token
     - View info
     - Delete tunnel

2. **Quick Tunnel TreeView**
   - Status monitoring
   - Quick actions
   - Port management

### Logging Architecture

The logging system is built around component-based logging with file rotation:

```
~/.vscode/extensions/cloudflare-tunnel/logs/
├── extension.log       # Extension lifecycle events
├── tunnel.log         # Tunnel operations
├── command.log        # Command executions
└── quick_tunnel.log   # Quick tunnel operations
```

Each log type includes:
- Timestamp
- Log level (DEBUG, INFO, WARN, ERROR)
- Component identifier
- Message
- Context data (when relevant)

### Tunnel Management

Two types of tunnels are supported:
1. **Persistent Tunnels**
   - Created via cloudflared CLI
   - Stored in Cloudflare configuration
   - Permanent configuration

2. **Quick Tunnels**
   - Created on-demand
   - Temporary configuration
   - Direct local forwarding

### Security Architecture

The extension implements a comprehensive security system for handling sensitive data:

1. **Token Security**
   - Secure storage using VSCode's secrets API
   - AES-256-GCM encryption for in-memory tokens
   - Auto-clearing clipboard after 30 seconds
   - Rate limiting and lockout after failed attempts
   - Full audit trail of all token operations

2. **Token Storage Layers**
   ```
   User Request
        ↓
   TokenService
        ↓
   Memory (Encrypted) ←→ VSCode Secrets
   ```

3. **Security Features**
   - Encrypted in-memory storage
   - Secure clipboard handling
   - Rate limiting
   - Operation auditing
   - Auto-clearing sensitive data
   - Warning prompts for sensitive operations

4. **Audit System**
   - Tracks all token operations
   - Records timestamps and outcomes
   - Monitors failed attempts
   - Maintains secure audit logs
   - Implements log rotation

### Docker Compose Generation

The extension includes a Docker Compose generator for containerized tunnel deployment:

1. **Component Structure**
   ```
   User Action (Docker button)
        ↓
   Command Handler
        ↓
   DockerComposeGenerator
        ↓
   Generated Files:
   - docker-compose.{tunnel}.yml
   - cloudflare.{tunnel}.env
   ```

2. **Security Features**
   - Token stored in separate environment file
   - Environment file named uniquely per tunnel
   - Clear documentation for secure usage

3. **Configuration Options**
   - Host machine service connection
   - Container service connection
   - Network configuration
   - Automatic restart handling

4. **File Generation**
   - Workspace-aware file creation
   - Untitled file support for no workspace
   - Clear usage instructions
   - Network configuration examples

## Development Workflow

### Setting Up Development Environment

1. **Prerequisites Installation**
   ```bash
   npm install
   npm install -g yo generator-code
   ```

2. **VS Code Setup**
   - Install recommended extensions
   - Use TypeScript workspace version
   - Enable ESLint

3. **Development Commands**
   ```bash
   npm run watch     # Start compilation in watch mode
   npm run lint      # Run ESLint
   npm run test      # Run tests
   ```

4. **Script Organization**
   The project uses a set of standardized scripts for git operations:
   ```
   scripts/
   ├── git-utils.sh            # Shared git utilities and functions
   ├── merge-to-development.sh # Merge current branch to development
   ├── merge-to-main.sh       # Merge current branch to main
   └── publish.sh             # Publish to VS Code Marketplace
   ```

   Key features of the scripts:
   - Consistent error handling and color output
   - Shared utility functions
   - Test enforcement before merges
   - Automatic rollback on failures
   - Branch protection
   - Clear user feedback

   Usage:
   ```bash
   # Merge to development
   ./scripts/merge-to-development.sh

   # Merge to main
   ./scripts/merge-to-main.sh

   # Publish extension
   ./scripts/publish.sh
   ```

### Making Changes

1. **Adding New Features**
   - Update DEVELOPMENT_PLAN.md
   - Add necessary service methods
   - Implement UI components
   - Add logging statements
   - Update package.json for new commands

2. **Modifying Existing Features**
   - Check existing logs for component behavior
   - Update relevant service methods
   - Update UI if needed
   - Add migration code if needed

### Testing

1. **Local Testing**
   - Use `F5` to launch Extension Development Host
   - Check logs in Output panel
   - Verify all log files are created

2. **Manual Testing Checklist**
   - Profile creation/switching
   - Tunnel operations
   - Quick tunnel functionality
   - Log rotation
   - Error handling

## Testing Architecture

The testing system is built around several layers:

1. **Unit Tests** (`src/test/unit/`)
   - `tokenService.test.ts`: Tests token security features
   - `tokenAuditService.test.ts`: Tests audit functionality
   - `utils.test.ts`: Tests utility functions

2. **Test Categories**
   - Security feature testing
   - Error handling and recovery
   - Rate limiting and lockout
   - Audit logging
   - Memory management

3. **Testing Tools**
   - Mocha test framework
   - Sinon for mocking and stubs
   - VSCode test utilities
   - Custom test helpers

4. **Test Coverage Areas**
   ```
   Security Tests
   ├── Token Storage
   │   ├── Secure storage
   │   ├── Memory encryption
   │   └── Cleanup
   ├── Clipboard Handling
   │   ├── Copy operations
   │   ├── Auto-clear
   │   └── Warning prompts
   ├── Rate Limiting
   │   ├── Failed attempts
   │   ├── Lockout periods
   │   └── Reset conditions
   └── Audit System
       ├── Event recording
       ├── Log rotation
       └── Query capabilities
   ```

## Testing Guide for Tunnelfy

### Test Setup Overview

The Tunnelfy extension uses the VS Code Extension Testing framework along with Mocha as the test runner. Tests are written in TypeScript and compiled to JavaScript during the test process.

### Directory Structure

```
src/test/
├── suite/                 # Test suite files
│   ├── extension.test.ts  # Main test file for extension
│   ├── tunnels.test.ts   # Tunnel management tests
│   ├── cloudflared.test.ts # Cloudflared service tests
│   ├── quickTunnels.test.ts # Quick tunnel tests
│   └── index.ts          # Test suite runner configuration
├── runTest.ts            # Test runner entry point
└── tsconfig.json         # TypeScript config for tests
```

### Running Tests

#### Quick Start

To run all tests:
```bash
npm run test
```

This command will:
1. Clean the test output directory (`npm run clean-tests`)
2. Compile the extension (`npm run compile`)
3. Compile the tests (`npm run compile-tests`)
4. Run the test suite

#### Test Scripts

The following npm scripts are available for testing:

- `npm run test`: Run all tests
- `npm run clean-tests`: Clean the test output directory
- `npm run compile-tests`: Compile test files only
- `npm run pretest`: Run all pre-test setup (cleaning and compilation)

### Writing Tests

#### Test File Location

Create new test files in the `src/test/suite/` directory with the `.test.ts` extension.

#### Test Structure

Tests use Mocha's testing framework. Here's a basic example:

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Your Test Suite Name', () => {
    // Run before all tests in the suite
    suiteSetup(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    // Individual test
    test('Your Test Name', async () => {
        // Your test code here
        assert.ok(true);
    });

    // Run after all tests in the suite
    suiteTeardown(() => {
        // Cleanup code
    });
});
```

#### Best Practices

1. **Isolation**: Each test should be independent and not rely on the state from other tests.
2. **Async/Await**: Use async/await for asynchronous operations:
   ```typescript
   test('Async test', async () => {
       const result = await someAsyncOperation();
       assert.ok(result);
   });
   ```
3. **Cleanup**: Use `suiteSetup` and `suiteTeardown` to handle setup and cleanup.
4. **Error Handling**: Test both success and error cases:
   ```typescript
   test('Error handling', async () => {
       try {
           await functionThatMightFail();
           assert.fail('Expected an error');
       } catch (error) {
           assert.ok(error instanceof Error);
       }
   });
   ```

### Test Configuration

#### TypeScript Configuration

Tests use a separate TypeScript configuration in `src/test/tsconfig.json`:
```json
{
    "extends": "../../tsconfig.json",
    "compilerOptions": {
        "module": "commonjs",
        "target": "ES2020",
        "outDir": "../../out/test",
        "rootDir": "../",
        "sourceMap": true
    }
}
```

#### VS Code Test Runner Configuration

The test runner is configured in `src/test/runTest.ts` with specific launch arguments:
```typescript
await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
        '--disable-extensions',
        '--disable-gpu',
        '--disable-workspace-trust'
    ]
});
```

### Debugging Tests

1. Open the Debug view in VS Code (Cmd+Shift+D)
2. Select "Extension Tests" from the dropdown
3. Press F5 to start debugging

The tests will run in a new VS Code window, and you can:
- Set breakpoints in your test files
- Step through test execution
- Inspect variables
- Use the Debug Console

### Common Issues and Solutions

1. **Tests Not Running**: 
   - Ensure all TypeScript files are compiled
   - Run `npm run clean-tests` followed by `npm test`

2. **Test Discovery Issues**:
   - Verify test files end with `.test.ts`
   - Check that test files are in the `src/test/suite` directory

3. **Compilation Errors**:
   - Run `npm run compile-tests` to see detailed errors
   - Check TypeScript configuration in `src/test/tsconfig.json`

4. **VS Code Extension Host Issues**:
   - Clear the VS Code extension development host:
     ```bash
     rm -rf .vscode-test
     ```
   - Run tests again

### Adding New Tests

1. Create a new file in `src/test/suite/` with the `.test.ts` extension
2. Import required modules:
   ```typescript
   import * as assert from 'assert';
   import * as vscode from 'vscode';
   ```
3. Write your tests using the Mocha framework
4. Run `npm test` to verify your tests

Remember to test both positive and negative cases, and ensure your tests are isolated and independent of each other.

## Security Development Guidelines

1. **Token Handling**
   ```typescript
   // Always use TokenService for token operations
   const token = await tokenService.getTunnelToken(tunnelId);

   // Never store tokens in plain text
   // ❌ Bad
   this.tokens.set(tunnelId, token);
   // ✅ Good
   await tokenService.storeTunnelToken(tunnelId, token);
   ```

2. **Clipboard Operations**
   ```typescript
   // Always use secure clipboard handling
   // ❌ Bad
   await vscode.env.clipboard.writeText(token);
   // ✅ Good
   const disposable = await tokenService.copyTokenToClipboard(token);
   context.subscriptions.push(disposable);
   ```

3. **Audit Logging**
   ```typescript
   // Record all security-relevant operations
   await auditService.recordEvent({
     action: 'access',
     tunnelId,
     success: true
   });
   ```

## Testing Guidelines

1. **Security Testing**
   - Test all error paths
   - Verify encryption
   - Check rate limiting
   - Validate audit trails

2. **Running Tests**
   ```bash
   # Run all tests
   npm test

   # Run specific test suite
   npm test -- --grep "TokenService"

   # Run with coverage
   npm run test:coverage
   ```

3. **Writing Security Tests**
   ```typescript
   test('Rate limiting after failed attempts', async () => {
     // Simulate failed attempts
     for (let i = 0; i < 5; i++) {
       try {
         await tokenService.getTunnelToken('non-existent');
       } catch (error) {
         // Expected error
       }
     }

     // Verify lockout
     await assert.rejects(
       tokenService.getTunnelToken('valid-id'),
       /Too many failed attempts/
     );
   });
   ```

## Key Files and Their Purposes

```
cloudflare-vscode/
├── src/
│   ├── extension.ts               # Extension entry point
│   ├── services/
│   │   ├── cloudflaredService.ts  # Cloudflare CLI integration
│   │   ├── profileManager.ts      # Profile management
│   │   ├── loggingService.ts      # Logging system
│   │   ├── tokenService.ts        # Token management
│   │   └── tokenAuditService.ts   # Token audit
│   ├── views/
│   │   ├── tunnelTreeView.ts      # Tunnel UI
│   │   └── profilesView.ts        # Profile UI
│   └── utils/                     # Helper functions
├── _DEV/
│   ├── DEVELOPMENT_PLAN.md        # Project roadmap
│   └── DEVELOPMENT_NOTES.md       # This file
└── package.json                   # Extension manifest
```

## Common Development Tasks

### Adding a New Command

1. Add command definition to `package.json`:
   ```json
   {
     "contributes": {
       "commands": [
         {
           "command": "cloudflare-tunnel.newCommand",
           "title": "New Command",
           "category": "Cloudflare"
         }
       ]
     }
   }
   ```

2. Register command in `extension.ts`:
   ```typescript
   context.subscriptions.push(
     vscode.commands.registerCommand('cloudflare-tunnel.newCommand', () => {
       logger.info(LogComponent.COMMAND, 'Executing new command');
       // Implementation
     })
   );
   ```

### Git Workflow

1. **Feature Development**
   ```bash
   # Create feature branch
   git checkout -b feature/your-feature

   # Make changes and commit
   git add .
   git commit -m "feat: your feature description"

   # Merge to development
   ./scripts/merge-to-development.sh
   ```

2. **Release Process**
   ```bash
   # Merge to main
   ./scripts/merge-to-main.sh

   # Publish extension
   ./scripts/publish.sh
   ```

### Adding New Logging Component

1. Add to `LogComponent` enum in `loggingService.ts`:
   ```typescript
   export enum LogComponent {
     NEW_COMPONENT = 'NEW_COMPONENT'
   }
   ```

2. Use in code:
   ```typescript
   logger.info(LogComponent.NEW_COMPONENT, 'Message');
   ```

### Modifying Tunnel Behavior

1. Update `CloudflaredService` methods
2. Add appropriate logging
3. Update UI in `TunnelTreeDataProvider`
4. Test with both persistent and quick tunnels

## Troubleshooting Development

### Common Issues

1. **Cloudflared CLI Issues**
   - Check `tunnel.log` for command execution details
   - Verify environment variables in command execution
   - Check certificate paths

2. **UI Update Issues**
   - Verify TreeView refresh calls
   - Check event emitters
   - Look for errors in `extension.log`

3. **Profile Management Issues**
   - Check profile configuration in `~/.cloudflared/`
   - Verify file permissions
   - Review `command.log` for operation sequence

### Debugging Tips

1. Use VS Code's built-in debugger
2. Set breakpoints in service methods
3. Monitor log files in real-time
4. Use `console.log` for temporary debugging
5. Check Output panel for immediate feedback

## Best Practices

1. **Logging**
   - Log all significant operations
   - Include relevant context data
   - Use appropriate log levels
   - Keep sensitive data out of logs

2. **Error Handling**
   - Log errors with full context
   - Provide user-friendly error messages
   - Handle cleanup in error cases
   - Maintain extension stability

3. **Code Organization**
   - Keep services focused and single-purpose
   - Use TypeScript features appropriately
   - Follow VS Code extension guidelines
   - Maintain clear separation of concerns

4. **Testing**
   - Write tests for new features
   - Update existing tests when modifying features
   - Test error conditions
   - Verify logging behavior

## Additional Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Cloudflare API Documentation](https://api.cloudflare.com/)
- [cloudflared Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)