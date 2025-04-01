#!/bin/bash

# Colors for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export NC='\033[0m' # No Color

# Check if we're on a specific branch
check_current_branch() {
	local target_branch=$1
	local current_branch=$(git rev-parse --abbrev-ref HEAD)

	if [ "$current_branch" = "$target_branch" ]; then
		echo -e "${RED}Error: You are currently on $target_branch branch.${NC}"
		echo -e "Please checkout your feature branch first."
		return 1
	fi
	return 0
}

# Check for uncommitted changes
check_uncommitted_changes() {
	local status_output=$(git status --porcelain)
	if [ -n "$status_output" ]; then
		echo -e "${RED}Error: You have uncommitted changes.${NC}"
		echo -e "Please commit or stash them before merging."
		return 1
	fi
	return 0
}

# Run tests and check result
run_tests() {
	# Check if we're on a machine with a long path
	if [[ "$PWD" == *"NR Dropbox"* ]]; then
		echo -e "${YELLOW}Skipping tests on this machine due to long path issues.${NC}"
		echo -e "${YELLOW}WARNING: Merging without running tests. Make sure they pass on another machine.${NC}"
		return 0
	fi

	echo -e "${YELLOW}Running tests...${NC}"
	npm test
	local TEST_EXIT_CODE=$?

	if [ $TEST_EXIT_CODE -ne 0 ]; then
		echo -e "${RED}Tests failed. Cannot proceed with merge.${NC}"
		return 1
	fi

	echo -e "${GREEN}Tests passed successfully!${NC}"
	return 0
}

# Merge changes into target branch
merge_branch() {
	local source_branch=$1
	local target_branch=$2

	# Switch to target branch
	echo -e "${YELLOW}Switching to $target_branch branch...${NC}"
	if ! git checkout "$target_branch"; then
		echo -e "${RED}Failed to switch to $target_branch branch${NC}"
		return 1
	fi

	# Pull latest changes
	echo -e "${YELLOW}Pulling latest changes from $target_branch...${NC}"
	if ! git pull origin "$target_branch"; then
		echo -e "${RED}Failed to pull latest changes${NC}"
		git checkout "$source_branch"
		return 1
	fi

	# Merge source branch
	echo -e "${YELLOW}Merging $source_branch into $target_branch...${NC}"
	if ! git merge --no-ff -m "Merging $source_branch into $target_branch" "$source_branch"; then
		echo -e "${RED}Failed to merge $source_branch into $target_branch${NC}"
		echo -e "Please resolve conflicts and try again"
		git checkout "$source_branch"
		return 1
	fi

	# Push changes
	echo -e "${YELLOW}Pushing changes to $target_branch...${NC}"
	if ! git push origin "$target_branch"; then
		echo -e "${RED}Failed to push to $target_branch${NC}"
		echo -e "Rolling back merge..."
		git reset --hard HEAD@{1}
		git checkout "$source_branch"
		return 1
	fi

	return 0
}
