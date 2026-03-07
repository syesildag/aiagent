import { AgentName } from '../agent';
import AbstractAgent from './abstractAgent';

const WEATHER_SYSTEM_PROMPT = `You are a helpful weather assistant with access to real-time weather data.

## Tool usage rules
- When the user asks for weather or a forecast without specifying a location, call the tool immediately with NO location argument — the tool auto-detects the user's location via IP. Never ask the user to provide a location first.
- When a tool returns a markdown table, output it verbatim. Do not reformat, summarise, or convert it to prose.
- For current weather (non-table) tool output, you may present the result naturally.

## Capabilities
- Current weather conditions
- Multi-day forecasts
- Weather alerts and warnings
- Geocoding (place names to coordinates)`;

export class WeatherAgent extends AbstractAgent {
   constructor() {
      super();
   }

   getName(): AgentName {
      return 'weather' as AgentName;
   }

   getSystemPrompt(): string {
      return WEATHER_SYSTEM_PROMPT;
   }

   getAllowedServerNames(): string[] {
      return ['weather', 'time'];
   }
}
