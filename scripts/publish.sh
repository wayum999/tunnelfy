#!/bin/bash

# Source shared utilities
source "$(dirname "$0")/git-utils.sh"

# Get current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Ensure we're on main branch
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}Error: Publishing must be done from the main branch.${NC}"
    echo -e "Current branch: $CURRENT_BRANCH"
    exit 1
fi

# Check for uncommitted changes
check_uncommitted_changes || exit 1

# Run tests before publishing
run_tests || exit 1

# Publish to VS Code Marketplace
echo -e "${YELLOW}Publishing to VS Code Marketplace...${NC}"
if ! vsce publish; then
    echo -e "${RED}Failed to publish extension${NC}"
    exit 1
fi

echo -e "${GREEN}Successfully published extension!${NC}" 