---
description: Create a git commit with a meaningful message based on staged changes
allowed-tools: "*"
---

## Context

- **Branch:** !`git branch --show-current`
- **Staged changes:**
```
!`git diff --cached --stat`
```
- **Full staged diff:**
```
!`git diff --cached`
```
- **Recent commits (for context):**
```
!`git log --oneline -5`
```

## Your task

Based on the staged changes above, write a concise and descriptive commit message following conventional commit format (e.g. `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).

Then run:
```
git commit -m "<your message here>"
```

If there are no staged changes, tell the user and suggest running `git add` first.
