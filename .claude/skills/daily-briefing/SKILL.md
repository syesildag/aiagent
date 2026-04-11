---
name: daily-briefing
description: Daily briefing — weather, time, news and personal context from memory
argument-hint: "[city or location]"
user-invocable: true
metadata:
  tags: [briefing, daily, morning, news, weather, today, summary, digest]
  allowed-tools: memory, weather, time, tavily-search, outlook
  max-iterations: 20
  fresh-context: true
  injectable: true
---

**CALL TOOLS IMMEDIATELY. Do NOT write any text before your first tool call. Do not narrate, plan, or describe what you will do — execute the tools directly.**

You must now produce a personalised daily briefing by calling tools in the exact sequence below.

**IMPORTANT:** Call every tool listed. Do not skip any step.

**LANGUAGE:** Write the entire briefing — all summaries, thoughts, and suggestions — in the language most appropriate for the user's location (e.g. French for France, Spanish for Spain). Use English only if the location resolves to an English-speaking country.

---

### 1. Personal context — call memory_search NOW
Query: `user context location interests projects preferences`
Store the results; use them to personalise every subsequent step.

### 2. Current time — call get_current_time NOW
Use the result for the briefing header.

### 3. Calendar — call outlook_listCalendarEvents NOW
Use the current time from step 2 to set `startDateTime` to now and `endDateTime` to the coming Saturday at 23:59:59 (i.e. the Saturday that ends the Mon–Sat work week, not next Sunday).
Save all returned events for the briefing.

### 4. Weather — call weather_forecast NOW
$IF $1
Location: **$1**
$ELSE
Omit the location argument — the tool will auto-detect it via IP.
$ENDIF
Use `days: 3`. Save the exact markdown table returned — you will paste it verbatim into the briefing.

### 5. Local news — call tavily_search NOW (query 1)
Construct the query from the location determined in step 4, e.g.:
`"[city] local news today"`
Collect the top 3–5 results. Use the Tavily title and snippet only. Save the URLs.

### 6. World headlines — call tavily_search NOW (query 2)
Query: `"top world news headlines today"`
Collect the top 5 results. Use the Tavily title and snippet only. Save the URLs.

### 7. Topic news — call tavily_search NOW (query 3)
Based on the user's interests from step 1, search for a relevant topic, e.g.:
`"[interest] news today"`
Collect 2–3 results. Use the Tavily title and snippet only. Save the URLs.

### 8. Recall active tasks — call memory_search NOW
Query: `tasks goals reminders todos action items`
Use these to inform the suggestions section.

---

### Final output

After all tool calls are complete, write the briefing in this format.
**For each news item, use the Tavily title and snippet as the summary. Display the URL so the user can read the full article.**

```
# 📅 Daily Briefing — [Day, Date] at [Time]

## 👤 Good [morning/afternoon/evening], [current authenticated username]

## 📅 This Week's Calendar
[List each event: time, title, and location if present. If no events, say "No upcoming events this week."]

## 🌤 Weather — [Location]
[Paste the markdown table from step 4 exactly as returned — do not reformat]

## 🗞 Local News — [Location]
1. **[Headline]** — [2–3 sentence summary based on scraped article content] ([source URL])
...

## 🌍 World Headlines
1. **[Headline]** — [2–3 sentence summary based on scraped article content] ([source URL])
...

## 🎯 Your Topics — [topic]
1. **[Headline]** — [2–3 sentence summary based on scraped article content] ([source URL])
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
