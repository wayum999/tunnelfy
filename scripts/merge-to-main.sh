#!/bin/bash

# Source shared utilities
source "$(dirname "$0")/git-utils.sh"

# Get current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Perform checks
check_current_branch "main" || exit 1
check_uncommitted_changes || exit 1

# Run initial tests
run_tests || exit 1

# Fetch latest changes from remote
echo -e "${YELLOW}Fetching latest changes from remote...${NC}"
git fetch origin main

# Try to merge main into current branch first
echo -e "${YELLOW}Merging main into $CURRENT_BRANCH...${NC}"
if ! git merge origin/main; then
    echo -e "${RED}Failed to merge main into $CURRENT_BRANCH${NC}"
    echo -e "Please resolve conflicts and try again"
    exit 1
fi

# Run tests after merging main
run_tests || exit 1

# Perform the merge to main
merge_branch "$CURRENT_BRANCH" "main" || exit 1

# Run final tests
run_tests || {
    echo -e "${RED}Tests failed after merge. Rolling back...${NC}"
    git reset --hard HEAD@{1}
    git checkout "$CURRENT_BRANCH"
    exit 1
}

# Switch back to feature branch
git checkout "$CURRENT_BRANCH"

echo -e "${GREEN}Successfully merged $CURRENT_BRANCH into main!${NC}" 