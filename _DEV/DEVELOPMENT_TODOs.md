# TODOs

## [ ] Code Quality Issues to Address

### src/commands/profileCommands.ts
- [ ] Reduce number of returns in `registerProfileCommands` (currently 9)
- [ ] Reduce total complexity of `registerProfileCommands` (currently 67)
- [ ] Refactor duplicate code blocks:
  ```typescript
  if (confirm === "Delete") {
    const isActiveProfile = await profileManager.isActiveProfile(
      item.label,
    );
    const allProfiles = await profileManager.listProfiles();
    // ... 22 more lines
  ```
  Found in 2 locations with mass = 123

### src/commands/quickTunnelCommands.ts
- [ ] Reduce number of returns in `registerQuickTunnelCommands` (currently 10)
- [ ] Reduce total complexity of `registerQuickTunnelCommands` (currently 64)

### src/commands/tunnelCommands.ts
- [ ] Reduce number of parameters in `registerTunnelCommands` (currently 7)
- [ ] Reduce number of returns in `registerTunnelCommands` (currently 31)
- [ ] Reduce total complexity of `registerTunnelCommands` (currently 147)
- [ ] Refactor duplicate code blocks:
  ```typescript
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.generateDockerCompose",
      async (item?: TunnelTreeItem) => {
        try {
          // If called from tree view, use the selected item
          // ... 69 more lines
  ```
  Found in 2 locations with mass = 277

### src/services/cloudflared/TunnelManager.ts
- [ ] Reduce number of returns in `createQuickTunnel` (currently 7)
- [ ] Reduce deeply nested control flow (level 5) in quick tunnels code
- [ ] Reduce total complexity (currently 166)
- [ ] Reduce complexity in the following functions:
  - `findCloudflaredProcesses` (currently 22)
  - `killProcess` (currently 25)
  - `getQuickTunnels` (currently 19)
  - `createQuickTunnel` (currently 56)

### src/services/systemServiceGenerator.ts
- [ ] Reduce complexity of `generateServiceFile` (currently 18)

### src/views/tunnelTreeView.ts
- [ ] Reduce number of parameters in constructor (currently 6)
- [ ] Reduce number of returns in `getChildren` (currently 7)
- [ ] Reduce total complexity (currently 51)
- [ ] Reduce complexity of `getChildren` (currently 33)

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
