---
description: Remove a note from long-term memory
allowed-tools: mcp__memory__memory_search, mcp__memory__memory_delete
---

## Task

Remove the following from long-term memory: **$ARGUMENTS**

1. Call `memory_search` with the argument as the query to find matching memories.
2. Show the user the top matches with their IDs and content.
3. Delete the best matching memory (or multiple if clearly all relevant) using `memory_delete` with the appropriate ID(s).
4. If no matching memory is found, tell the user clearly.
5. Confirm what was deleted.
