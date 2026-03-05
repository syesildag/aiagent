---
description: Daily briefing — weather, time, news and personal context from memory
argument-hint: [city or location]
allowed-tools: memory, weather, time, tavily-search
max-iterations: 10
---

You must now produce a personalised daily briefing by calling tools in the exact sequence below. Do NOT describe what you will do — call each tool immediately and use its output.

**IMPORTANT:** Call every tool listed. Do not skip any step.

---

### 1. Personal context — call memory_search NOW
Query: `user context location interests projects preferences`
Store the results; use them to personalise every subsequent step.

### 2. Current time — call get_current_time NOW
Use the result for the briefing header.

### 3. Weather — call get_weather NOW
$IF $1
Location: **$1**
$ELSE
Location: use the city found in memory from step 1, or default to the user's most recently known city.
$ENDIF
Report temperature, conditions, and any alerts.

### 4. Local news — call tavily_search NOW (query 1)
Construct the query from the location determined in step 3, e.g.:
`"[city] local news today"`
Collect the top 3–5 results.

### 5. World headlines — call tavily_search NOW (query 2)
Query: `"top world news headlines today"`
Collect the top 5 results.

### 6. Topic news — call tavily_search NOW (query 3)
Based on the user's interests from step 1, search for a relevant topic, e.g.:
`"[interest] news today"`
Collect 2–3 results.

### 7. Recall active tasks — call memory_search NOW
Query: `tasks goals reminders todos action items`
Use these to inform the suggestions section.

---

### Final output

After all tool calls are complete, write the briefing in this format:

```
# 📅 Daily Briefing — [Day, Date] at [Time]

## 👤 Good [morning/afternoon/evening][, name if known from memory]

## 🌤 Weather — [Location]
[Weather summary]

## 🗞 Local News — [Location]
1. **[Headline]** — [one sentence] ([source URL])
...

## 🌍 World Headlines
1. **[Headline]** — [one sentence] ([source URL])
...

## 🎯 Your Topics — [topic]
1. **[Headline]** — [one sentence] ([source URL])
...

## 💡 Quick Thought
One sentence connecting today's context with the user's current goals or projects.

## 🤖 Suggested Actions
Provide 3–5 concrete, actionable suggestions for the user's day. Base them on:
- Pending tasks or goals found in memory
- Anything time-sensitive in today's news that may affect their projects or interests
- Weather conditions (e.g. reschedule outdoor plans)
- Any opportunities or risks surfaced by the world/local/topic news

Format as a numbered list. Each suggestion must be specific and immediately actionable — not generic advice.
Example: "1. Review the new EU AI regulation draft (in today's world news) — it may affect the compliance work on Project X."
```

Be concise. The whole briefing should be readable in under two minutes.
