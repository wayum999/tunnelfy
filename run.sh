#!/bin/bash

# Tunnelfy Run Script
# This script provides commands to run the extension and tests

# Function to display help
show_help() {
  echo "Tunnelfy Run Script"
  echo "Usage: ./run.sh [command]"
  echo ""
  echo "Commands:"
  echo "  test       Run all tests"
  echo "  compile    Compile the extension"
  echo "  watch      Watch for changes and recompile"
  echo "  clean      Clean the output directories"
  echo "  package    Package the extension for distribution"
  echo "  help       Show this help message"
  echo ""
}

# Function to run tests
run_tests() {
  echo "Running tests..."
  npm run test
}

# Function to compile the extension
compile() {
  echo "Compiling extension..."
  npm run compile
}

# Function to watch for changes
watch() {
  echo "Watching for changes..."
  npm run watch
}

# Function to clean output directories
clean() {
  echo "Cleaning output directories..."
  rimraf out
  rimraf dist
}

# Function to package the extension
package() {
  echo "Packaging extension..."
  npm run package
}

# Main script logic
case "$1" in
  test)
    run_tests
    ;;
  compile)
    compile
    ;;
  watch)
    watch
    ;;
  clean)
    clean
    ;;
  package)
    package
    ;;
  help|*)
    show_help
    ;;
esac

exit 0 