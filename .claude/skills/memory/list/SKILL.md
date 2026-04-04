---
name: list
description: List long-term memories, optionally filtered by type or tag
user-invocable: true
metadata:
  allowed-tools: memory
  injectable: false
---

## Task

**$ARGUMENTS**

- If no argument is provided: call `memory_list` with no filters to return all memories.
- If an argument is provided: call `memory_search` with the argument as the query to return semantically relevant memories.

Display results in a readable format: ID, type, content, tags, and created date for each entry. If nothing is found, say so clearly.
