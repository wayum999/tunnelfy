# Code Standards for Tunnelfy

This document outlines coding standards and best practices for the Tunnelfy extension development.

## Table of Contents

- [General Principles](#general-principles)
- [File Organization](#file-organization)
- [Naming Conventions](#naming-conventions)
- [Code Style](#code-style)
- [Centralized Messages](#centralized-messages)
- [Error Handling](#error-handling)
- [Logging](#logging)
- [UI Components](#ui-components)
- [Testing](#testing)

## General Principles

- Follow the Single Responsibility Principle
- Write code that is self-documenting
- Include comments for complex logic
- Keep methods focused and concise
- Use TypeScript features appropriately

## File Organization

- Group related functionality in directories
- Use a consistent file naming scheme
- Keep file sizes manageable (aim for under 500 lines)
- Organize imports logically (VS Code, then third-party, then local)

## Naming Conventions

- Use `camelCase` for variables and methods
- Use `PascalCase` for classes, interfaces, and types
- Use `UPPER_CASE` for constants
- Use descriptive names that clearly indicate purpose

## Code Style

- Use 2-space indentation
- Prefer const over let where possible
- Use semicolons at the end of statements
- Follow ESLint rules
- Use async/await rather than promise chains

## Centralized Messages

### User-Facing Messages

All user-facing messages should be defined in the centralized `Messages` class in `src/utils/messages.ts`. This ensures:

1. Consistent messaging throughout the application
2. Easy updates to text content without searching the codebase
3. Simplified localization if needed in the future
4. Ability to reuse common messages

### Adding New Messages

When adding new functionality that requires user-facing messages:

1. Add a static property to the `Messages` class:

```typescript
// For simple strings
static readonly YOUR_MESSAGE = "Your message text";

// For parameterized strings
static readonly PARAMETERIZED_MESSAGE = (param1: string, param2: number) => 
  `Message with ${param1} and ${param2}`;

// For messages with title and detail
static readonly COMPLEX_MESSAGE = {
  message: "Main message",
  detail: "Detailed explanation"
};
```

2. Use the message in your code:

```typescript
// Simple message
await Messages.showInfo(Messages.YOUR_MESSAGE);

// Parameterized message
await Messages.showInfo(Messages.PARAMETERIZED_MESSAGE("value", 42));

// Complex message
await Messages.showError(Messages.COMPLEX_MESSAGE);
```

### Message Types

- **Information Messages**: Use for success notifications and general information
- **Warning Messages**: Use for non-critical issues that don't prevent operation
- **Error Messages**: Use for issues that prevent an operation from succeeding
- **Modal Messages**: Use for confirmations or important decisions

### Message Guidelines

- Keep messages clear, concise, and user-friendly
- Avoid technical jargon unless necessary
- Include specific details for error messages
- Group related messages together in the Messages class
- Use consistent terminology throughout all messages

### Examples

```typescript
// Input prompts
static readonly ADDRESS_INPUT_PROMPT = 
  "Enter EITHER the full address to tunnel OR just the port number if using localhost...";

// Validation errors
static readonly ADDRESS_INPUT_VALIDATION_ERROR = 
  "Please enter a valid URL or a valid port number";

// Success messages
static readonly TUNNEL_CREATED = (name: string) =>
  `Tunnel "${name}" has been created.`;

// Error messages
static readonly ERROR_CREATE_TUNNEL = (error: any) => ({
  message: "Failed to create tunnel",
  detail: String(error),
});
```

## Error Handling

- Use try/catch blocks for error handling
- Log detailed errors to the console
- Show user-friendly error messages
- Include relevant context in error messages
- Clean up resources when errors occur

## Logging

- Use the Logger service for all logging
- Include the appropriate component in log calls
- Use appropriate log levels (debug, info, warn, error)
- Include relevant context data in logs
- Avoid logging sensitive information

## UI Components

- Use the VS Code UI components consistently
- Follow the VS Code UI design patterns
- Support keyboard navigation
- Handle all possible UI states (loading, empty, error)
- Consider accessibility in UI design

## Testing

- Write tests for all new functionality
- Update tests when modifying existing functionality
- Test happy path and error cases
- Mock external dependencies
- Ensure tests are isolated and don't rely on global state 