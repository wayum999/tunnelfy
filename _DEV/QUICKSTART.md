# Tunnelfy Developer Quickstart Guide

Welcome to the Tunnelfy extension development! This guide will help you get up and running quickly.

## Getting Started in 10 Minutes

### Prerequisites

- Node.js (v16 or higher)
- Git
- Visual Studio Code
- Cloudflared CLI (for testing)
- TypeScript knowledge

### Quick Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd tunnelfy
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start development mode:**
   ```bash
   npm run watch
   ```

4. **Launch the extension:**
   - Press `F5` in VS Code to open a new Extension Development Host window
   - The extension should appear in the sidebar with the Tunnelfy icon

## Project Overview

Tunnelfy is a VS Code extension that provides a convenient interface for managing Cloudflare tunnels directly within your development environment.

### Key Features

- Create and manage Cloudflare tunnels
- Launch quick tunnels for temporary access
- Generate Docker Compose and system service files
- Manage Cloudflare profiles
- Secure handling of tokens and credentials

### Architecture at a Glance

```
src/
├── commands/           # Command implementations
├── services/           # Core business logic
│   ├── cloudflareApi/  # Cloudflare API integration
│   ├── cloudflared/    # Cloudflared CLI integration
│   └── ...             # Other services
├── utils/              # Utility functions and helpers
├── views/              # UI components and tree views
└── extension.ts        # Main entry point
```

## Essential Files

As a new contributor, focus on these files first:

1. `src/extension.ts` - Main extension entry point
2. `src/services/cloudflared/TunnelManager.ts` - Core tunnel management
3. `src/utils/messages.ts` - Centralized user messages
4. `src/commands/*.ts` - Command implementations
5. `src/views/*.ts` - UI components
6. `_DEV/*.md` - Development documentation

## Common Development Tasks

### Adding a New Command

1. Add command definition to `package.json`:
   ```json
   {
     "contributes": {
       "commands": [
         {
           "command": "tunnelfy.newCommand",
           "title": "New Command",
           "category": "Tunnelfy"
         }
       ]
     }
   }
   ```

2. Create or update a command file in `src/commands/`:
   ```typescript
   vscode.commands.registerCommand("tunnelfy.newCommand", async () => {
     try {
       // Command implementation
     } catch (error) {
       logger.error(LogComponent.COMMAND, "Error executing command", error);
       Messages.showError(Messages.ERROR_GENERIC(error));
     }
   });
   ```

### Adding New User Messages

1. Add your message to `src/utils/messages.ts`:
   ```typescript
   static readonly YOUR_MESSAGE = "Your message text";
   // or
   static readonly YOUR_MESSAGE = (param: string) => `Message with ${param}`;
   ```

2. Use the message in your code:
   ```typescript
   Messages.showInfo(Messages.YOUR_MESSAGE);
   ```

### Modifying UI Components

UI components are defined in the `src/views/` directory, with each view handling a specific part of the interface.

To update a tree view:
1. Modify the TreeItem class to change item appearance
2. Update the TreeDataProvider to change how data is loaded
3. Update the TreeView initialization in `extension.ts` if needed

### Testing Your Changes

1. Run type checking and compilation:
   ```bash
   npm run compile
   ```

2. Run linting:
   ```bash
   npm run lint
   ```

3. Run tests:
   ```bash
   npm test
   ```

4. Manual testing:
   - Press F5 to launch the extension in development mode
   - Use the extension commands and UI to verify your changes

## Coding Standards

Follow these essential guidelines:

1. Use TypeScript features appropriately
2. Add proper error handling with try/catch blocks
3. Add meaningful log messages for operations and errors
4. Place user-facing messages in the Messages class
5. Follow the existing code style and patterns
6. Write tests for new functionality

## Documentation

Make sure to update relevant documentation when you change features:

1. Update `_DEV/*.md` files for developer documentation
2. Update `README.md` for user-facing changes
3. Add code comments for complex logic
4. Document new commands, settings, or features

## Getting Help

If you need help or have questions:

1. Check the `_DEV/` directory for detailed development docs
2. Review the existing code for similar patterns
3. Read the VS Code extension documentation for API questions
4. Reach out to the team through the project's communication channels

## Before Submitting

Before submitting your changes:

1. Ensure all tests pass
2. Run linting and fix any issues
3. Test your changes thoroughly
4. Update relevant documentation
5. Make sure your commits follow project conventions

## Advanced Topics

For more detailed information, refer to these documents:

- `_DEV/DEVELOPMENT_README.md` - Comprehensive development guide
- `_DEV/CODE_STANDARDS.md` - Detailed coding standards
- `_DEV/TESTING_README.md` - Guide to writing and running tests
- `_DEV/DEVELOPMENT_PLAN.md` - Project roadmap and plans 