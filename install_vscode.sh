#!/bin/bash

# To insall on Widsurf or Cursor, go to install from VSIX in command menu...
# Ensure we're in the extension directory
cd "$(dirname "$0")"

# Find the latest .vsix file
VSIX_FILE=$(find dist -name "*.vsix" -type f -print0 | xargs -0 ls -t | head -n1)

if [ -z "$VSIX_FILE" ]; then
    echo "No .vsix file found in dist/ directory. Please run package.sh first."
    exit 1
fi

# Install the extension
code --install-extension "$VSIX_FILE"

echo "Extension installed successfully!"
