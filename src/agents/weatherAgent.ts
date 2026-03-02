import { AgentName } from '../agent';
import AbstractAgent from './abstractAgent';

const WEATHER_SYSTEM_PROMPT = `You are a helpful weather assistant. You have access to real-time weather data.

Use the available weather tools to answer user queries about:
- Current weather conditions for any location
- Weather forecasts (hourly and daily)
- Weather alerts and warnings
- Historical weather data
- Geocoding (converting place names to coordinates)

Always provide clear, human-readable weather summaries. Include relevant details like temperature (both Celsius and Fahrenheit when useful), wind speed, humidity, and precipitation. Mention any active weather alerts when present.`;

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
