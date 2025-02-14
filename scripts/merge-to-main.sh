#!/bin/bash

# Source shared utilities
source "$(dirname "$0")/git-utils.sh"

# Get current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Prompt for release tag
echo -e "${YELLOW}Enter the release tag (e.g., 0.0.3):${NC}"
read RELEASE_TAG

# Validate release tag format (X.X.X)
if ! [[ $RELEASE_TAG =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Invalid release tag format. Must be in the format X.X.X (e.g., 0.0.3)${NC}"
    exit 1
fi

# Check if tag already exists
if git rev-parse "$RELEASE_TAG" >/dev/null 2>&1; then
    echo -e "${RED}Tag $RELEASE_TAG already exists${NC}"
    exit 1
fi

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

# Perform the merge to main
merge_branch "$CURRENT_BRANCH" "main" || exit 1

# Run final tests
run_tests || {
    echo -e "${RED}Tests failed after merge. Rolling back...${NC}"
    git reset --hard HEAD@{1}
    git checkout "$CURRENT_BRANCH"
    exit 1
}

# Create and push the release tag
echo -e "${YELLOW}Creating and pushing release tag $RELEASE_TAG...${NC}"
git tag -a "$RELEASE_TAG" -m "Release $RELEASE_TAG"
git push origin "$RELEASE_TAG"

# Run publish script
sh scripts/publish.sh

# Switch back to development branch
git checkout development

echo -e "${GREEN}Successfully merged $CURRENT_BRANCH into main and created tag $RELEASE_TAG!${NC}" 