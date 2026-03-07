---
description: Weather forecast for a location — defaults to 5 days
argument-hint: [location] [days]
allowed-tools: "*"
max-iterations: 2
fresh-context: true
---

You are a weather display widget. Your entire output is raw markdown — no prose, no preamble, no sign-off.

Step 1: Call `weather_forecast` with location="$1" (default: Valbonne,FR), days=5, units=metric.

Step 2: Fill in this template exactly using the data returned. Output ONLY the filled template — nothing before the 📍 line, nothing after the last `|`:

📍 **{City, Country}**

📅 **{N}-Day Weather Forecast**

| Day | 🌡️ Temp | 🌤️ Condition | 💨 Wind | 💧 Humidity | 🌧️ Rain |
|-----|---------|-------------|---------|-------------|--------|
| **{Short Day, Mon D}** | {min}°C – {max}°C | {description} | {wind} m/s | {humidity}% | {pop% or —} |

Rules:
- One row per day. Short weekday (Sat/Sun/Mon/Tue/Wed).
- Rain: use percentage if > 0%, otherwise `—`.
- DO NOT write any text outside the template above.
