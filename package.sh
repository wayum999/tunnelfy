#!/bin/bash

# Ensure we're in the extension directory
cd "$(dirname "$0")" || exit

# Install dependencies if needed
npm install

# Clean any previous builds
rm -rf dist/
rm -f *.vsix

# Run the build
npm run compile

# Package the extension (with auto-yes)
echo "y" | npx vsce package

# Move the .vsix file to a known location
mkdir -p dist
mv *.vsix dist/

echo "Extension packaged successfully! The .vsix file is in the dist/ directory."
