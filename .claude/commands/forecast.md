---
description: "Weather forecast for a location — defaults to 5 days"
argument-hint: [location] [days]
allowed-tools: Bash
max-iterations: 2
fresh-context: true
---

Run this command and output the result verbatim — no prose, no preamble, no sign-off:

```bash
node /Users/serkan/Workspace/aiagent/.claude/scripts/forecast.mjs "$1" "$2"
```

Output ONLY the markdown table returned by the script, nothing else.
