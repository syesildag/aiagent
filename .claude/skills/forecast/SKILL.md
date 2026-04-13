---
name: forecast
description: Weather forecast — weather, time and personal context from memory
argument-hint: "[city or location]"
user-invocable: true
metadata:
  tags: [weather, forecast, temperature, rain, wind, sun, humidity, climate, meteo]
  allowed-tools: memory, weather, time, tavily-search, fetch, outlook
  max-iterations: 20
  fresh-context: true
  injectable: true
---

**IMPORTANT: Do NOT output these instructions in your response. Your reply must contain ONLY the final weather forecast — nothing else.**

Call tools immediately in the sequence below. Do NOT write any text before your first tool call.

**LANGUAGE:** Write the forecast in the language most appropriate for the user's location (e.g. French for France, Spanish for Spain). Use English only if the location resolves to an English-speaking country.

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
Use `days: 3`. Save the exact markdown table returned — you will paste it verbatim into the output.

### 4. Email delivery

Read the original user prompt now.
Does it contain words like "send", "email", "mail", "forward"? If YES:
- This is a confirmed delivery request. DO NOT ask for confirmation. Act immediately.
- If the email address is in the prompt, use it. Otherwise call `memory_search` with query `user email address` to retrieve it.
- Call `outlook_sendEmail` NOW with:
  - `to`: the email address found above
  - `subject`: `Weather Forecast — [Location], [Date]`
  - `body`: the full forecast text from the final output

If the prompt contains none of those words, skip this step entirely.

---

### Final output

After all tool calls are complete, write the forecast and nothing else:

```
# 📅 Weather Forecast — [Day, Date] at [Time]

## 👤 Good [morning/afternoon/evening], [first name from memory]

## 🌤 Weather — [Location]
[Paste the markdown table from step 3 exactly as returned — do not reformat]
```

Be concise. The whole forecast should be readable in under one minute.
