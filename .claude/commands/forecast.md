---
description: Weather forecast — weather, time and personal context from memory
argument-hint: [city or location]
allowed-tools: memory, weather, time, tavily-search, fetch
max-iterations: 20
fresh-context: true
---

**CALL TOOLS IMMEDIATELY. Do NOT write any text before your first tool call. Do not narrate, plan, or describe what you will do — execute the tools directly.**

You must give weather foreast by calling tools in the exact sequence below.

**IMPORTANT:** Call every tool listed. Do not skip any step.

**LANGUAGE:** Write the foreast in the language most appropriate for the user's location (e.g. French for France, Spanish for Spain). Use English only if the location resolves to an English-speaking country.

---

### 1. Personal context — call memory_search NOW
Query: `user context location`
Store the results; use them to personalise every subsequent step.

### 2. Current time — call get_current_time NOW
Use the result for the briefing header.

### 3. Weather — call weather_forecast NOW
$IF $1
Location: **$1**
$ELSE
Omit the location argument — the tool will auto-detect it via IP.
$ENDIF
Use `days: 3`. Save the exact markdown table returned — you will paste it verbatim into the briefing.

---

### Final output

After all tool calls are complete, write the forecast in this format.
**For each news item, use the scraped article text from fetch_url (steps 4b/5b/6b) as the basis for the summary — not just the Tavily snippet.** If an article failed to scrape, fall back to the Tavily snippet.

```
# 📅 Weather Forecast — [Day, Date] at [Time]

## 👤 Good [morning/afternoon/evening], [current authenticated username]

## 🌤 Weather — [Location]
[Paste the markdown table from step 3 exactly as returned — do not reformat]

Format as a numbered list. Each suggestion must be specific and immediately actionable — not generic advice.
Example: "1. Review the new EU AI regulation draft (in today's world news) — it may affect the compliance work on Project X."
```

Be concise. The whole forecast should be readable in under one minute.
