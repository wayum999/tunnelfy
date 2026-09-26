# Change Log

All notable changes to the "tunnelfy" extension will be documented in this file.

## [0.2.1] - 2026-09-26

- UPDATED: Cloudflare lists (tunnels, zones, DNS records) now load every page, not just the first.
- UPDATED: Deleted tunnels are filtered out by Cloudflare itself.
- UPDATED: Cloudflare API requests time out after 15 seconds.
- FIXED: A failed or malformed list now shows an error in the tree instead of an empty list.
- UPDATED: Tunnelfy now starts when one of its views is opened or one of its commands runs, not when VS Code starts. Closes #11.
- UPDATED: `cloudflared` is checked for only when an action needs it, and the `tunnelfy.checkCloudflared` setting turns the check off.
- NOTE: If VS Code crashes, the Tunnelfy tunnels it left running are picked up the next time the Tunnelfy view is opened or a Tunnelfy command runs, no longer at startup.
- FIXED: Views, timers and listeners are disposed when the extension shuts down, and a group expanded later lists tunnels afresh.

## [0.2.0]

- SECURITY: Tunnel tokens are no longer stored on disk or passed to `cloudflared` on the command line.
- SECURITY: Generated service and environment files are created with mode 0600 (owner read/write only).
- SECURITY: Tunnel configuration is no longer written to the log.
- UPDATED: Tunnels the extension starts are tracked per window and are stopped when that window closes or reloads. Closes #12.
- UPDATED: Stop is offered only for tunnels this window started.
- FIXED: Docker Compose and system service generation now use the correct tunnel id.
- UPDATED: Continuous integration added.
- UPDATED: The packaged extension is a production build that contains only its runtime files.

## [0.0.91]
- FIXED: Cloudflared check on Linux not working

## [0.0.9]

- ADDED: Configuration option `tunnelfy.checkCloudflared` to control cloudflared installation checks on startup.
- IMPROVED: Users can now disable cloudflared startup checks if they have cloudflared installed in a custom location.
- UPDATED: Status bar indicator shows appropriate message when cloudflared check is disabled.
- UPDATED: Simplified cloudflared detection logic for better user experience.

## [0.0.8]

- UPDATED: Testing and test coverage.
- UPDATED: Changlog adjustment.

## [0.0.7]

- UPDATED: Testing and test coverage.

## [0.0.6]

- FIXED: Small bugs

## [0.0.5]

- FIXED: Gracefully handle the case where no profile is set.
- UPDATED: README, CODE_OF_CONDUCT.md, CONTRIBUTING.md, ISSUE_TEMPLATE.md, and SECURITY.md.

## [0.0.4]

- UPDATED: Testing and test coverage.
- ADDED: Confirmation before stopping a tunnel.
- UPDAED: Centralized alert message system and cleanup.
- UPDATED: Make scripts more modular for maintanability.
- ADDED: Docker Compose file generation for tunnels.
- ADDED: System service file generation for tunnels.
- UPDATED: DNS listing to not show TXT records.
- ADDED: Status indicator for cloudflared installation.
- ADDED: Option for remote of locally managed tunnels.
- UPDATED: List view to show local and remote tunnels separately.

## [0.0.3]

Major update to how the extension functions, using the Cloudflare API to handle interaction with account data and tunnel management.

- UPDATED: Continued work on testing suite.
- UPDATED: README Changelog linkage to the CHANGELOG.md file.
- FIXED: Multiple bugs with the extension and tunnel management.
- ADDED: Cloudflare API key storage and management.
- ADDED: Cloudflared API functionality.
- UPDATED: Modularized codebase for better readability and maintainability.

## [0.0.2]

- FIXED: Bug where stopping a tunnel would not work. Changed method to killing the process instead of using tunnel cleanup.
- UPDATED: README with troubleshooting and more information regarding persistent tunnels not respecting the URL and port you provide due to the tunnel being set up through the online dashboard.
- UPDATED: Extension description to more accurately describe the purpose of the extension.

## [0.0.1]

- Initial release