#!/usr/bin/env node

/**
 * This script cleans up the test directories that can cause socket path length issues.
 * Run this before running VSCode tests if you encounter socket path length errors.
 */

const path = require('path');
const fs = require('fs');
const rimraf = require('rimraf');

// Define paths to clean
const paths = [
  // VSCode test directories
  path.resolve(__dirname, '../.vscode-test'),
  // Temp directories
  '/tmp/tf',
  // If you're using VSCode Test Explorer, it might create additional directories
  path.resolve(__dirname, '../.vscode-test-explorer')
];

// Clean each path
paths.forEach(p => {
  if (fs.existsSync(p)) {
    console.log(`Cleaning: ${p}`);
    try {
      rimraf.sync(p);
      console.log(`Successfully cleaned: ${p}`);
    } catch (err) {
      console.error(`Error cleaning ${p}:`, err);
    }
  } else {
    console.log(`Path does not exist, skipping: ${p}`);
  }
});

console.log('Cleanup complete. You should now be able to run tests without socket path length issues.'); 