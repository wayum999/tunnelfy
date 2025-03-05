# Testing Documentation

## Overview

This document provides comprehensive guidance for working with the testing environment in this VS Code extension. The testing framework is built on Mocha with TypeScript support and integrates with VS Code's extension testing utilities. Tests run in an Electron environment, as VS Code itself is built on Electron.

## Testing Stack

- **Test Framework**: Mocha
- **Runtime Environment**: Electron
- **Test Runner**: Extension Test Runner (Microsoft)
- **Assertion Library**: Node's built-in assert module
- **Mocking Framework**: Sinon
- **Additional Tools**: VS Code test utilities, Custom test helpers

## Extension Test Runner

The Microsoft Extension Test Runner is used to execute tests and provides test coverage information. This tool:
- Provides a dedicated test environment that mirrors VS Code
- Manages the VS Code instance during testing
- Handles extension activation/deactivation
- Shows test coverage directly in the editor
- Integrates with VS Code's Extension Development Host

To view test results and coverage:
1. Open the Testing sidebar in VS Code
2. Use the Extension Test Runner interface to:
   - Run individual tests
   - Debug specific test cases
   - View code coverage in the editor
   - Navigate to test definitions

## Directory Structure

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

## Running Tests

### Available Commands

```bash
npm run test              # Run all tests
npm run clean-tests      # Clean the test output directory
npm run compile-tests    # Compile test files only
npm run pretest         # Run all pre-test setup
npm test -- --grep "TokenService"  # Run specific test suite
```

### Test Execution Process

When you run `npm run test`, the following steps occur:

1. Clean the test output directory (`npm run clean-tests`)
2. Compile the extension (`npm run compile`)
3. Compile the tests (`npm run compile-tests`)
4. Launch Electron test environment
5. Execute the test suite within Extension Test Runner

## Writing Tests

### Creating a New Test File

1. Create a new file in `src/test/suite/` with the `.test.ts` extension
2. Follow this basic structure:

```typescript
import * as assert from "assert";
import * as vscode from "vscode";

suite("Your Test Suite Name", () => {
    suiteSetup(async () => {
        // Setup code that runs before all tests
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });

    test("Your Test Name", async () => {
        // Your test code here
        assert.ok(true);
    });

    suiteTeardown(() => {
        // Cleanup code that runs after all tests
    });
});
```

### Best Practices

1. **Test Independence**
   - Each test should be self-contained
   - Don't rely on state from other tests
   - Clean up after each test

2. **Async/Await Usage**
   ```typescript
   test("Async operations", async () => {
       const result = await someAsyncOperation();
       assert.ok(result);
   });
   ```

3. **Error Testing**
   ```typescript
   test("Error handling", async () => {
       try {
           await functionThatShouldFail();
           assert.fail("Expected an error");
       } catch (error) {
           assert.ok(error instanceof Error);
       }
   });
   ```

4. **Setup and Teardown**
   - Use `suiteSetup` for suite-level setup
   - Use `setup` for test-level setup
   - Use `teardown` for test-level cleanup
   - Use `suiteTeardown` for suite-level cleanup

## Test Configuration

### TypeScript Configuration

Test-specific TypeScript configuration in `src/test/tsconfig.json`:

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

### VS Code Test Runner Configuration

The test runner configuration in `src/test/runTest.ts`:

```typescript
await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
        "--disable-extensions",
        "--disable-gpu",
        "--disable-workspace-trust"
    ]
});
```

## Debugging Tests

1. **Using VS Code Debugger**
   - Open Debug view (Cmd+Shift+D)
   - Select "Extension Tests" from dropdown
   - Press F5 to start debugging

2. **Available Debug Features**
   - Set breakpoints in test files
   - Step through test execution
   - Inspect variables
   - Use Debug Console

3. **Electron DevTools**
   - Access Electron DevTools during test runs
   - Debug renderer process issues
   - Monitor network requests
   - Profile performance

## Common Issues and Solutions

### Tests Not Running
- **Issue**: Tests fail to execute
- **Solution**: 
  ```bash
  npm run clean-tests
  npm run compile
  npm test
  ```

### Test Discovery Problems
- **Issue**: Tests not being found
- **Solution**: 
  - Ensure test files end with `.test.ts`
  - Verify files are in `src/test/suite`

### Compilation Errors
- **Issue**: TypeScript compilation fails
- **Solution**:
  ```bash
  npm run compile-tests
  ```
  Check the output for detailed error messages

### VS Code Extension Host Issues
- **Issue**: Extension host problems
- **Solution**:
  ```bash
  rm -rf .vscode-test
  npm test
  ```

### Electron-Specific Issues
- **Issue**: Renderer process crashes
- **Solution**:
  - Check for async operation timing
  - Verify VS Code API usage
  - Examine Electron logs

## Coverage Information

Test coverage can be viewed directly in VS Code using the Extension Test Runner:
1. Install the Extension Test Runner
2. Open the Testing sidebar
3. Run your tests
4. Coverage information will be highlighted in the editor

This provides visual feedback about:
- Which lines of code are covered by tests
- Which branches have been tested
- Areas that need additional test coverage

## Adding New Test Categories

When adding new feature tests:

1. Create a new test file in `src/test/suite/`
2. Follow the existing naming convention: `featureName.test.ts`
3. Import necessary dependencies
4. Structure tests using suites and test cases
5. Include both positive and negative test cases
6. Add appropriate error handling tests
7. Document any special setup requirements

## Testing Security Features

Security-related tests should include:

1. Token handling verification
2. Rate limiting checks
3. Encryption validation
4. Audit logging confirmation
5. Memory cleanup verification

Remember to test both successful and failure scenarios for security features.