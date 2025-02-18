# TODOs

## [ ] Update DEVELOPMENT_README.md

1. Update DEVELOPMENT_README.md with:
   - Latest project information and architecture details
   - Development environment setup instructions
   - Build and test procedures
   - Code organization and structure

2. Add comprehensive documentation for:
   - Process for adding new functionality
   - Steps for modifying list views and UI components
   - Extension command implementation
   - Service layer modifications
   - Testing requirements and procedures

3. Ensure documentation is:
   - Clear and thorough
   - Easy to follow for new developers
   - Accurate and up-to-date
   - Contains relevant code examples


# [ ]Testing Enhancements and Organization
1. Organize Test Directory Structure
   - Create /test directory with subdirectories:
     - /unit for pure logic and helper function tests
     - /integration for VS Code API dependent tests  
     - /e2e for full workflow tests
   - Move existing tests into appropriate directories

2. Update Package.json Test Scripts
   - Add separate test commands:
     ```json
     "test": "npm run test:unit && npm run test:integration",
     "test:unit": "mocha --require ts-node/register test/unit/**/*.test.ts",
     "test:integration": "vscode-test --run test/integration",
     "test:e2e": "vscode-test --run test/e2e"
     ```

3. Implement API Mocking
   - Add sinon mocks for external API calls in unit tests
   - Create mock responses for Cloudflare API
   - Add afterEach() cleanup to restore mocks
   - Example implementation:
     ```typescript
     import * as sinon from "sinon";
     import * as cloudflare from "../src/cloudflareApi";
     const apiStub = sinon.stub(cloudflare, "createTunnel");
     apiStub.resolves({ id: "mock-tunnel", status: "running" });
     ```

4. Set Up Test Debugging
   - Add debugging command: `npm test -- --inspect-brk`
   - Add VS Code launch configuration:
     ```json
     {
       "type": "node",
       "request": "attach",
       "name": "Debug Tests",
       "port": 9229,
       "restart": true,
       "protocol": "inspector"
     }
     ```

5. Configure CI Pipeline
   - Create GitHub Actions workflow file
   - Add test automation on push/pull request
   - Example workflow:
     ```yaml
     name: CI Test
     on: [push, pull_request]
     jobs:
       test:
         runs-on: ubuntu-latest
         steps:
           - uses: actions/checkout@v3
           - uses: actions/setup-node@v3
             with:
               node-version: 18
           - run: npm install
           - run: npm test
     ```

6. Add Pre-publish Safety Check
   - Add to package.json: `"prepublishOnly": "npm test"`

7. Verify Implementation
   - Confirm tests are properly organized
   - Verify all test scripts work
   - Test API mocking functionality
   - Check debugging capabilities
   - Test CI pipeline
   - Validate pre-publish checks

   # Persistent Tunnels When Extension is Closed

   ## Action Steps

   1. Implement Background Process Support
      - Add detached process spawning using child_process.spawn()
      - Create tunnel state storage file
      - Add process unref() to prevent VS Code waiting
      - Store process info and PID

   2. Add State Management
      - Create tunnel state file for storing running tunnel info
      - Implement getStoredTunnels() to read state
      - Add process status checking with isProcessRunning()
      - Handle state cleanup when stopping tunnels

   3. Implement Extension Activation Logic  
      - Check for stored tunnels on startup
      - Verify running processes
      - Reconnect or restart tunnels as needed
      - Log tunnel status changes

   4. Add Process Control Functions
      - Implement startTunnel() with background process creation
      - Add stopTunnel() with process cleanup
      - Handle error cases and logging
      - Clean up state file entries

   5. Add System Service Support (Optional)
      - Linux: Create systemd service file
      - macOS: Create launchd plist file  
      - Add service control commands
      - Handle permissions and user context

   6. Testing & Validation
      - Test process persistence across VS Code restarts
      - Verify state management and cleanup
      - Test service installation if implemented
      - Validate error handling

   7. Documentation
      - Document setup steps for users
      - Add troubleshooting guide
      - Include OS-specific instructions
      - Note permission requirements
