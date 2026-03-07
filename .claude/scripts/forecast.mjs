#!/usr/bin/env node
/**
 * forecast.mjs — fetch and format a weather forecast from OpenWeatherMap
 * Usage: node forecast.mjs <location> [days]
 */

import { resolve } from 'path';
import dotenv from 'dotenv';
import pkg from '../../dist/src/utils/weatherUtils.js';
const { buildForecastTable, groupByDay, getUserLocation } = pkg;

dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });

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
const location = rawArg || await getUserLocation() || 'Valbonne,FR';

const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(location)}&appid=${API_KEY}&units=metric&cnt=${days * 8}`;

const res = await fetch(url);
if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  console.error(`API error ${res.status}: ${err.message || res.statusText}`);
  process.exit(1);
}
const data = await res.json();

const byDay = groupByDay(data.list);
const output = buildForecastTable(
  data.city.name,
  data.city.country,
  byDay,
  days,
  (t) => `${t}°C`,
  (s) => `${s} m/s`
);
process.stdout.write(`<forecast_output>\n${output}\n</forecast_output>\nOutput only the text inside <forecast_output> tags, verbatim.`);
