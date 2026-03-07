#!/usr/bin/env node
/**
 * forecast.mjs — fetch and format a weather forecast from OpenWeatherMap
 * Usage: node forecast.mjs <location> [days]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env from project root if API key not already in environment
function loadEnv() {
  const envPath = resolve(import.meta.dirname, '../../.env');
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      if (key && rest.length && !process.env[key.trim()]) {
        process.env[key.trim()] = rest.join('=').trim();
      }
    }
  } catch {}
}
loadEnv();

const API_KEY = process.env.OPENWEATHERMAP_API_KEY;
if (!API_KEY) { console.error('OPENWEATHERMAP_API_KEY not set'); process.exit(1); }

// Accept either: "London,UK" "5"  OR  "London,UK 5"  (raw slash-command arg)
let rawArg = (process.argv[2] || '').trim();
let days = 5;
const trailingInt = rawArg.match(/\s+([1-5])$/);
if (trailingInt) {
  days = parseInt(trailingInt[1], 10);
  rawArg = rawArg.slice(0, -trailingInt[0].length).trim();
} else if (process.argv[3]) {
  days = Math.min(5, Math.max(1, parseInt(process.argv[3], 10) || 5));
}
const location = rawArg || 'Valbonne,FR';

const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(location)}&appid=${API_KEY}&units=metric&cnt=${days * 8}`;

const res = await fetch(url);
if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  console.error(`API error ${res.status}: ${err.message || res.statusText}`);
  process.exit(1);
}
const data = await res.json();

// Group 3-hour slots by calendar day
const byDay = new Map();
for (const item of data.list) {
  const key = new Date(item.dt * 1000).toDateString();
  if (!byDay.has(key)) byDay.set(key, []);
  byDay.get(key).push(item);
}

const lines = [];
lines.push(`📍 **${data.city.name}, ${data.city.country}**`);
lines.push('');
lines.push(`📅 **${days}-Day Weather Forecast**`);
lines.push('');
lines.push('| Day | 🌡️ Temp | 🌤️ Condition | 💨 Wind | 💧 Humidity | 🌧️ Rain |');
lines.push('|-----|---------|-------------|---------|-------------|--------|');

for (const [dateKey, slots] of [...byDay.entries()].slice(0, days)) {
  const date = new Date(dateKey);
  const label = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const noon = slots.find(s => { const h = new Date(s.dt * 1000).getHours(); return h >= 11 && h <= 13; }) || slots[0];
  const minT = Math.round(Math.min(...slots.map(s => s.main.temp)));
  const maxT = Math.round(Math.max(...slots.map(s => s.main.temp)));
  const humidity = Math.round(slots.reduce((a, s) => a + s.main.humidity, 0) / slots.length);
  const pop = Math.max(...slots.map(s => s.pop || 0));
  const rain = pop > 0 ? `${Math.round(pop * 100)}%` : '—';

  lines.push(`| **${label}** | ${minT}°C – ${maxT}°C | ${noon.weather[0].description} | ${noon.wind.speed} m/s | ${humidity}% | ${rain} |`);
}

const output = lines.join('\n');
process.stdout.write(`<forecast_output>\n${output}\n</forecast_output>\nOutput only the text inside <forecast_output> tags, verbatim.`);
