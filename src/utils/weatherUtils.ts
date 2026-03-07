export function weatherIcon(id: number): string {
  if (id >= 200 && id < 300) return '⛈️';
  if (id >= 300 && id < 400) return '🌦️';
  if (id >= 500 && id < 600) return '🌧️';
  if (id >= 600 && id < 700) return '❄️';
  if (id >= 700 && id < 800) return '🌫️';
  if (id === 800) return '☀️';
  if (id === 801) return '🌤️';
  if (id === 802) return '⛅';
  if (id === 803) return '🌥️';
  if (id === 804) return '☁️';
  return '🌡️';
}

/** Groups OpenWeatherMap 3-hour forecast list into a Map keyed by calendar day string. */
export function groupByDay(list: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const item of list) {
    const key = new Date(item.dt * 1000).toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

/** Returns the slot closest to noon (11:00–13:00), falling back to the first slot. */
export function getNoonSlot(slots: any[]): any {
  return slots.find(s => { const h = new Date(s.dt * 1000).getHours(); return h >= 11 && h <= 13; }) || slots[0];
}

/** Builds a markdown forecast table from grouped day data. */
export function buildForecastTable(
  cityName: string,
  country: string,
  byDay: Map<string, any[]>,
  days: number,
  formatTemp: (t: number) => string,
  formatWind: (s: number) => string
): string {
  const lines: string[] = [];
  lines.push(`📍 **${cityName}, ${country}**`);
  lines.push('');
  lines.push(`📅 **${days}-Day Weather Forecast**`);
  lines.push('');
  lines.push('| Day | 🌡️ Temp | 🌤️ Condition | 💨 Wind | 💧 Humidity | 🌧️ Rain |');
  lines.push('|-----|---------|-------------|---------|-------------|--------|');
  for (const [dateKey, slots] of [...byDay.entries()].slice(0, days)) {
    const label = new Date(dateKey).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const noon = getNoonSlot(slots);
    const { minT, maxT, humidity, pop } = dayStats(slots);
    const icon = weatherIcon(noon.weather[0].id);
    const rain = pop > 0 ? `${Math.round(pop * 100)}%` : '—';
    lines.push(`| **${label}** | ${formatTemp(minT)} – ${formatTemp(maxT)} | ${icon} ${noon.weather[0].description} | ${formatWind(noon.wind.speed)} | ${humidity}% | ${rain} |`);
  }
  return lines.join('\n');
}

/** Resolves the caller's location via IP geolocation. Returns "City,CountryCode" or null on failure. */
export async function getUserLocation(): Promise<string | null> {
  try {
    const res = await fetch('http://ip-api.com/json?fields=city,countryCode,status');
    if (!res.ok) return null;
    const { city, countryCode, status } = await res.json() as { city?: string; countryCode?: string; status?: string };
    if (status === 'success' && city && countryCode) return `${city},${countryCode}`;
  } catch {
    // network failure — caller should use its own fallback
  }
  return null;
}

/** Computes daily aggregate stats from a day's 3-hour slots. */
export function dayStats(slots: any[]): { minT: number; maxT: number; humidity: number; pop: number } {
  return {
    minT: Math.round(Math.min(...slots.map(s => s.main.temp))),
    maxT: Math.round(Math.max(...slots.map(s => s.main.temp))),
    humidity: Math.round(slots.reduce((a: number, s: any) => a + s.main.humidity, 0) / slots.length),
    pop: Math.max(...slots.map(s => s.pop || 0)),
  };
}
