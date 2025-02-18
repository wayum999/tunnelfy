# Change Log

All notable changes to the "tunnelfy" extension will be documented in this file.

## [0.0.1]

- Initial release

## [0.0.2]

- FIXED: Bug where stopping a tunnel would not work. Changed method to killing the process instead of using tunnel cleanup.
- UPDATED: README with troubleshooting and more information regarding persistent tunnels not respecting the URL and port you provide due to the tunnel being set up through the online dashboard.
- UPDATED: Extension description to more accurately describe the purpose of the extension.

## [0.0.3]

Major update to how the extension functions, using the Cloudflare API to handle interaction with account data and tunnel management.

- UPDATED: Continued work on testing suite.
- UPDATED: README Changelog linkage to the CHANGELOG.md file.
- FIXED: Multiple bugs with the extension and tunnel management.
- ADDED: Cloudflare API key storage and management.
- ADDED: Cloudflared API functionality.
- UPDATED: Modularized codebase for better readability and maintainability.

## [0.0.4]

Moderate update with new Docker Compose file generation, fixing misc bugs and  cleanup. 

 - UPDATED: Testing and test coverage.
 - ADDED: Confirmation before stopping a tunnel.
 - UPDAED: Centralized alert message system and cleanup.
 - UPDATED: Make scripts more modular for maintanability.
 - ADDED: Docker Compose file generation for tunnels.