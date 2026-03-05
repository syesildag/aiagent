---
description: Show a summary of the current git repository status
allowed-tools: "*"
---

## Repository Status

**Current Branch:** !`git branch --show-current`

**Working Tree Status:**
```
!`git status --short`
```

**Recent Commits (last 5):**
```
!`git log --oneline -5`
```

**Remote Tracking:**
```
!`git fetch --dry-run 2>&1 || echo "(remote not available)"`
```

Summarise the above information and suggest the most useful next action (e.g. stage files, push, open a PR, or continue working).
