---
description: Summarize and compact conversation history to free context window space
disable-model-invocation: true
---

/compact is handled server-side — it summarizes the current conversation history into a brief summary, clears prior messages, and re-seeds with the summary so the context window is freed up.

Use this when the context meter shows high usage, or when the conversation has grown long and you want to start fresh while preserving important context.
