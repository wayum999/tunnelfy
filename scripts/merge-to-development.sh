#!/bin/bash

# Source shared utilities
source "$(dirname "$0")/git-utils.sh"

# Get current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Perform checks
check_current_branch "development" || exit 1
check_uncommitted_changes || exit 1

# Run initial tests
run_tests || exit 1

# Fetch latest changes from remote
echo -e "${YELLOW}Fetching latest changes from remote...${NC}"
git fetch origin development

# Try to merge development into current branch first
echo -e "${YELLOW}Merging development into $CURRENT_BRANCH...${NC}"
if ! git merge origin/development; then
    echo -e "${RED}Failed to merge development into $CURRENT_BRANCH${NC}"
    echo -e "Please resolve conflicts and try again"
    exit 1
fi

# Run tests after merging development
run_tests || exit 1

# Perform the merge to development
merge_branch "$CURRENT_BRANCH" "development" || exit 1

# Run final tests
run_tests || {
    echo -e "${RED}Tests failed after merge. Rolling back...${NC}"
    git reset --hard HEAD@{1}
    git checkout "$CURRENT_BRANCH"
    exit 1
}

# Switch back to feature branch
git checkout "$CURRENT_BRANCH"

echo -e "${GREEN}Successfully merged $CURRENT_BRANCH into development!${NC}" 