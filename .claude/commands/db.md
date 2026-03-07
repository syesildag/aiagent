---
description: Daily briefing — weather, time, news and personal context from memory
argument-hint: [city or location]
allowed-tools: memory, weather, time, tavily-search, fetch
max-iterations: 20
fresh-context: true
---

You must now produce a personalised daily briefing by calling tools in the exact sequence below. Do NOT describe what you will do — call each tool immediately and use its output.

**IMPORTANT:** Call every tool listed. Do not skip any step.

---

### 1. Personal context — call memory_search NOW
Query: `user context location interests projects preferences`
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

### 4. Local news — call tavily_search NOW (query 1)
Construct the query from the location determined in step 3, e.g.:
`"[city] local news today"`
Collect the top 3–5 results. Save the URLs.

### 4b. Scrape local news articles — call fetch_url for each URL from step 4
For the top 3 URLs from step 4, call `fetch_url` on each one.
Store the scraped `textContent` for each article — this is the real article body.
If a URL fails, skip it and continue.

### 5. World headlines — call tavily_search NOW (query 2)
Query: `"top world news headlines today"`
Collect the top 5 results. Save the URLs.

### 5b. Scrape world news articles — call fetch_url for each URL from step 5
For the top 3 URLs from step 5, call `fetch_url` on each one.
Store the scraped `textContent` for each article.
If a URL fails, skip it and continue.

### 6. Topic news — call tavily_search NOW (query 3)
Based on the user's interests from step 1, search for a relevant topic, e.g.:
`"[interest] news today"`
Collect 2–3 results. Save the URLs.

### 6b. Scrape topic articles — call fetch_url for each URL from step 6
For the top 2 URLs from step 6, call `fetch_url` on each one.
Store the scraped `textContent` for each article.
If a URL fails, skip it and continue.

### 7. Recall active tasks — call memory_search NOW
Query: `tasks goals reminders todos action items`
Use these to inform the suggestions section.

---

### Final output

After all tool calls are complete, write the briefing in this format.
**For each news item, use the scraped article text from fetch_url (steps 4b/5b/6b) as the basis for the summary — not just the Tavily snippet.** If an article failed to scrape, fall back to the Tavily snippet.

```
# 📅 Daily Briefing — [Day, Date] at [Time]

## 👤 Good [morning/afternoon/evening], [current authenticated username]

## 🌤 Weather — [Location]
[Paste the markdown table from step 3 exactly as returned — do not reformat]

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
