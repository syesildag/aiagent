---
description: Store a note into long-term memory for future conversations
allowed-tools: memory
---

## Task

Store the following note into long-term memory: **$ARGUMENTS**

Call `memory_create` with:
- `type`: one of `user`, `feedback`, `project`, or `reference` — choose based on the content
- `content`: the note text
- `source`: `"mlog"`
- `confidence`: `1`
- `tags`: 1–3 relevant tags derived from the content

Confirm to the user what was saved (type and any assigned ID).
