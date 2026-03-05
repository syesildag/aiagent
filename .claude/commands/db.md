---
description: Daily briefing — weather, time, news and personal context from memory
argument-hint: [city or location]
allowed-tools: memory, weather, time, tavily-search
---

You are preparing a personalised daily briefing. Follow every step below in order, using your tools, then produce the final report.

## Step 1 — Personal Context

Retrieve the current user's memories to understand their interests, location, ongoing projects, and preferences. Use these to personalise the news selection and the tone of the briefing.

## Step 2 — Time & Date

Fetch the current date and local time so the briefing header is accurate.

## Step 3 — Weather

$IF $1
Fetch the current weather for **$1**.
$ELSE
Fetch the current weather for the user's location (from memory, or default to their most recently known city).
$ENDIF

Include temperature, conditions, and any notable alerts.

## Step 4 — Local News

Search the web for today's top local news stories relevant to the user's location. Use a query like:
- `"[city] local news today"`
- `"[city] breaking news [current date]"`

Summarise the 3–5 most relevant stories with a one-sentence description each and a source URL.

## Step 5 — World News

Search the web for today's top world headlines. Use queries such as:
- `"top world news today [current date]"`
- `"breaking international news today"`

Summarise the 5 most important stories with a one-sentence description each and a source URL.

## Step 6 — Personalised Topics

Based on the user's interests discovered in Step 1, search for 2–3 additional topic-specific news items (e.g. technology, finance, sports) and include them under a "Your Topics" section.

---

## Final Report Format

Produce the briefing in this structure:

```
# 📅 Daily Briefing — [Day, Date] at [Time]

## 👤 Good [morning/afternoon/evening], [user name if known]

## 🌤 Weather — [Location]
[Weather summary]

## 🗞 Local News — [Location]
1. **[Headline]** — [one sentence summary] ([source])
...

## 🌍 World Headlines
1. **[Headline]** — [one sentence summary] ([source])
...

## 🎯 Your Topics
1. **[Headline]** — [one sentence summary] ([source])
...

## 💡 Quick Thought
A short, relevant observation tying together today's context and the user's current goals or projects from memory.
```

Be concise. Each news item should be one sentence. The whole briefing should be readable in under two minutes.
