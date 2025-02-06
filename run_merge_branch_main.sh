#!/bin/bash

# Exit on error
set -e

# Get the current branch name
CURRENT_BRANCH=$(git branch --show-current)

# Ensure we are not on main already
if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "You are already on the main branch. Switch to a feature branch before running this script."
  exit 1
fi

echo "Current branch: $CURRENT_BRANCH"

# Switch to main branch
echo "Switching to main branch..."
git checkout main

# Pull the latest changes from the remote main
echo "Pulling latest changes from main..."
git pull origin main

# Merge the feature branch into main
echo "Merging $CURRENT_BRANCH into main..."
git merge --no-ff -m "Merging $CURRENT_BRANCH into main" "$CURRENT_BRANCH"


# Push the merged changes to the remote repository
echo "Pushing changes to remote..."
git push origin main

echo "Merge complete!"

# Optional: Switch back to the feature branch
echo "Switching back to $CURRENT_BRANCH..."
git checkout "$CURRENT_BRANCH"

echo "Done."
