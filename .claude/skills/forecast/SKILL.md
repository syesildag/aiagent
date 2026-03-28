---
description: Weather forecast — weather, time and personal context from memory
argument-hint: "[city or location]"
user-invocable: true
metadata:
  allowed-tools: memory, weather, time, tavily-search, fetch, outlook
  max-iterations: 20
  fresh-context: true
  injectable: true
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

### 4. Email delivery

Read the original user prompt now.
Does it contain words like "send", "email", "mail", "forward"? If YES:
- This is a confirmed delivery request. DO NOT ask for confirmation. DO NOT say "let me know if you want me to send it". Act immediately.
- If the email address is in the prompt, use it. Otherwise call `memory_search` with query `user email address` to retrieve it.
- Call `outlook_sendEmail` NOW with:
  - `to`: the email address found above
  - `subject`: `Weather Forecast — [Location], [Date]`
  - `body`: the full forecast text from the final output

If the prompt contains none of those words, skip this step entirely.

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
