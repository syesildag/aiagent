---
description: Commit all staged changes, push the branch, and open a pull request
argument-hint: [pr-title]
allowed-tools: "*"
---

## Context

- **Branch:** !`git branch --show-current`
- **Staged diff:**
```
!`git diff --cached --stat`
```

## Your task

1. Create a commit with a meaningful message for the staged changes.
2. Push the current branch to `origin`.
3. Create a pull request titled "$ARGUMENTS" (use the branch changes as description if no title provided).

If the GitHub CLI (`gh`) is available use:
```
gh pr create --title "<title>" --body "<description>"
```

Otherwise provide the manual steps to open a PR on GitHub.
