#!/usr/bin/env node

/**
 * MCP Weather Server - OpenWeatherMap API integration
 * 
 * This server provides weather information using the OpenWeatherMap API:
 * - Using McpServer for modern MCP implementation
 * - Zod schema validation for type safety
 * - Resource templates with URI patterns for different weather data
 * - Comprehensive error handling and logging
 * - Support for current weather, forecasts, and weather alerts
 * - Geocoding support for location resolution
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Logger from "../../utils/logger.js";
import { config } from "../../utils/config.js";
import { weatherIcon, groupByDay, getNoonSlot, dayStats, buildForecastTable, getUserLocation } from "../../utils/weatherUtils.js";

// OpenWeatherMap API configuration
const OPENWEATHER_API_KEY = process.env.OPENWEATHERMAP_API_KEY || config.OPENWEATHERMAP_API_KEY;
const OPENWEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5";
const OPENWEATHER_GEO_URL = "https://api.openweathermap.org/geo/1.0";
const OPENWEATHER_ONECALL_URL = "https://api.openweathermap.org/data/3.0";

if (!OPENWEATHER_API_KEY) {
  Logger.error("OPENWEATHERMAP_API_KEY environment variable is required");
  process.exit(1);
}

/**
 * Input schemas for tools with comprehensive validation
 */
const CurrentWeatherInputSchema = z.object({
  location: z.string().optional().describe("City name, state/country code (e.g., 'London,UK') — omit to auto-detect from IP"),
  units: z.enum(["metric", "imperial", "kelvin"]).optional().describe("Temperature units: metric (°C), imperial (°F), or kelvin (K)")
});

const ForecastInputSchema = z.object({
  location: z.string().optional().describe("City name, state/country code — omit to auto-detect from IP"),
  days: z.number().int().min(1).max(5).optional().describe("Number of forecast days (1-5)"),
  units: z.enum(["metric", "imperial", "kelvin"]).optional().describe("Temperature units")
});

const WeatherAlertsInputSchema = z.object({
  lat: z.number().min(-90).max(90).describe("Latitude"),
  lon: z.number().min(-180).max(180).describe("Longitude")
});

const GeocodingInputSchema = z.object({
  location: z.string().min(1, "Location cannot be empty").describe("City name, state/country code"),
  limit: z.number().int().min(1).max(10).optional().describe("Maximum number of results (1-10)")
});

const HistoricalWeatherInputSchema = z.object({
  lat: z.number().min(-90).max(90).describe("Latitude"),
  lon: z.number().min(-180).max(180).describe("Longitude"),
  dt: z.number().int().positive().describe("Unix timestamp for the requested date")
});

/**
 * Weather data interfaces
 */
interface WeatherData {
  location: string;
  country: string;
  temperature: number;
  feels_like: number;
  humidity: number;
  pressure: number;
  visibility: number;
  uv_index?: number;
  weather: {
    main: string;
    description: string;
    icon: string;
  };
  wind: {
    speed: number;
    deg: number;
    gust?: number;
  };
  clouds: number;
  sunrise: number;
  sunset: number;
  timezone: string;
  units: string;
}

interface GeocodeResult {
  name: string;
  local_names?: Record<string, string>;
  lat: number;
  lon: number;
  country: string;
  state?: string;
}

/**
 * Utility functions
 */
async function makeWeatherRequest(url: string): Promise<any> {
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(`OpenWeatherMap API error (${response.status}): ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      Logger.error(`Weather API request failed: ${error.message}`, { url });
      throw error;
    }
    throw new Error(`Weather API request failed: ${String(error)}`);
  }
}

async function geocodeLocation(location: string): Promise<GeocodeResult[]> {
  const url = `${OPENWEATHER_GEO_URL}/direct?q=${encodeURIComponent(location)}&limit=5&appid=${OPENWEATHER_API_KEY}`;
  const results = await makeWeatherRequest(url);
  
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`Location not found: ${location}`);
  }
  
  return results;
}

function formatTemperature(temp: number, units: string = "metric"): string {
  switch (units) {
    case "imperial":
      return `${Math.round(temp)}°F`;
    case "kelvin":
      return `${Math.round(temp)}K`;
    default:
      return `${Math.round(temp)}°C`;
  }
}

function formatWindSpeed(speed: number, units: string = "metric"): string {
  switch (units) {
    case "imperial":
      return `${speed} mph`;
    default:
      return `${speed} m/s`;
  }
}

function formatWeatherData(data: any, units: string = "metric"): WeatherData {
  return {
    location: data.name,
    country: data.sys.country,
    temperature: data.main.temp,
    feels_like: data.main.feels_like,
    humidity: data.main.humidity,
    pressure: data.main.pressure,
    visibility: data.visibility || 0,
    weather: {
      main: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon
    },
    wind: {
      speed: data.wind.speed,
      deg: data.wind.deg,
      gust: data.wind.gust
    },
    clouds: data.clouds.all,
    sunrise: data.sys.sunrise,
    sunset: data.sys.sunset,
    timezone: data.timezone ? new Date(data.timezone * 1000).toISOString() : 'UTC',
    units
  };
}

/**
 * Create a modern MCP server using the high-level McpServer API
 */
const server = new McpServer({
  name: "weather-server",
  version: "1.0.0"
});

/**
 * Register weather conditions resource - current weather for major cities
 */
server.registerResource(
  "weather-dashboard",
  "weather://dashboard",
  {
    title: "Weather Dashboard",
    description: "Current weather conditions for major world cities",
    mimeType: "application/json"
  },
  async () => {
    try {
      const majorCities = [
        "London,UK", "New York,NY,US", "Tokyo,JP", "Paris,FR", "Sydney,AU",
        "Berlin,DE", "Moscow,RU", "Mumbai,IN", "São Paulo,BR", "Cairo,EG"
      ];

      const weatherPromises = majorCities.map(async (city) => {
        try {
          const url = `${OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=metric`;
          const data = await makeWeatherRequest(url);
          return {
            city: data.name,
            country: data.sys.country,
            temperature: Math.round(data.main.temp),
            description: data.weather[0].description,
            icon: data.weather[0].icon
          };
        } catch (error) {
          Logger.warn(`Failed to fetch weather for ${city}: ${error}`);
          return null;
        }
      });

      const results = await Promise.all(weatherPromises);
      const validResults = results.filter(result => result !== null);

      return {
        contents: [{
          uri: "weather://dashboard",
          mimeType: "application/json",
          text: JSON.stringify({
            timestamp: new Date().toISOString(),
            cities: validResults
          }, null, 2)
        }]
      };
    } catch (error) {
      Logger.error("Failed to fetch weather dashboard:", error);
      throw error;
    }
  }
);

/**
 * Register dynamic weather resource for specific locations
 */
server.registerResource(
  "current-weather",
  new ResourceTemplate("weather://current/{location}", {
    list: async () => {
      const commonLocations = [
        "London,UK", "New York,NY,US", "Tokyo,JP", "Paris,FR", "Sydney,AU",
        "Los Angeles,CA,US", "Chicago,IL,US", "Miami,FL,US", "Toronto,ON,CA"
      ];

      return {
        resources: commonLocations.map(location => ({
          uri: `weather://current/${encodeURIComponent(location)}`,
          name: `Current weather in ${location}`,
          description: `Real-time weather conditions for ${location}`,
          mimeType: "application/json"
        }))
      };
    }
  }),
  {
    title: "Current Weather",
    description: "Current weather conditions for a specific location"
  },
  async (uri, { location }) => {
    try {
      const locationStr = Array.isArray(location) ? location[0] : location;
      const decodedLocation = decodeURIComponent(locationStr);
      
      const url = `${OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(decodedLocation)}&appid=${OPENWEATHER_API_KEY}&units=metric`;
      const data = await makeWeatherRequest(url);
      const weatherData = formatWeatherData(data, "metric");

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(weatherData, null, 2)
        }]
      };
    } catch (error) {
      Logger.error(`Failed to fetch current weather for ${location}:`, error);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            location: Array.isArray(location) ? location[0] : location
          }, null, 2)
        }]
      };
    }
  }
);

/**
 * Register forecast resource
 */
server.registerResource(
  "forecast",
  new ResourceTemplate("weather://forecast/{location}/{days}", {
    list: async () => {
      const commonForecasts = [
        { location: "London,UK", days: "5" },
        { location: "New York,NY,US", days: "5" },
        { location: "Tokyo,JP", days: "3" }
      ];

      return {
        resources: commonForecasts.map(({ location, days }) => ({
          uri: `weather://forecast/${encodeURIComponent(location)}/${days}`,
          name: `${days}-day forecast for ${location}`,
          description: `Weather forecast for ${location}`,
          mimeType: "application/json"
        }))
      };
    }
  }),
  {
    title: "Weather Forecast",
    description: "Multi-day weather forecast"
  },
  async (uri, { location, days }) => {
    try {
      const locationStr = Array.isArray(location) ? location[0] : location;
      const daysStr = Array.isArray(days) ? days[0] : days;
      const decodedLocation = decodeURIComponent(locationStr);
      
      const url = `${OPENWEATHER_BASE_URL}/forecast?q=${encodeURIComponent(decodedLocation)}&appid=${OPENWEATHER_API_KEY}&units=metric&cnt=${parseInt(daysStr) * 8}`;
      const data = await makeWeatherRequest(url);

      const forecast = {
        location: data.city.name,
        country: data.city.country,
        timezone: data.city.timezone,
        forecast: data.list.map((item: any) => ({
          datetime: new Date(item.dt * 1000).toISOString(),
          temperature: Math.round(item.main.temp),
          feels_like: Math.round(item.main.feels_like),
          humidity: item.main.humidity,
          pressure: item.main.pressure,
          weather: {
            main: item.weather[0].main,
            description: item.weather[0].description,
            icon: item.weather[0].icon
          },
          wind: {
            speed: item.wind.speed,
            deg: item.wind.deg
          },
          clouds: item.clouds.all,
          pop: Math.round((item.pop || 0) * 100) // Probability of precipitation
        }))
      };

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(forecast, null, 2)
        }]
      };
    } catch (error) {
      Logger.error(`Failed to fetch forecast for ${location}:`, error);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            location: Array.isArray(location) ? location[0] : location
          }, null, 2)
        }]
      };
    }
  }
);

/**
 * Tool to get current weather for a location
 */
server.registerTool(
  "current_weather",
  {
    title: "Get Current Weather",
    description: "Get current weather conditions for a specific location",
    inputSchema: CurrentWeatherInputSchema
  },
  async ({ location, units = "metric" }) => {
    try {
      const resolvedLocation = location || await getUserLocation() || 'Valbonne,FR';
      const url = `${OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(resolvedLocation)}&appid=${OPENWEATHER_API_KEY}&units=${units}`;
      const data = await makeWeatherRequest(url);
      const weatherData = formatWeatherData(data, units);

      const summary = `📍 **${weatherData.location}, ${weatherData.country}**

🌡️ **Temperature:** ${formatTemperature(weatherData.temperature, units)} (feels like ${formatTemperature(weatherData.feels_like, units)})
🌤️ **Conditions:** ${weatherData.weather.description}
💨 **Wind:** ${formatWindSpeed(weatherData.wind.speed, units)} at ${weatherData.wind.deg}°
💧 **Humidity:** ${weatherData.humidity}%
📊 **Pressure:** ${weatherData.pressure} hPa
☁️ **Cloud Cover:** ${weatherData.clouds}%
👁️ **Visibility:** ${(weatherData.visibility / 1000).toFixed(1)} km

🌅 **Sunrise:** ${new Date(weatherData.sunrise * 1000).toLocaleTimeString()}
🌇 **Sunset:** ${new Date(weatherData.sunset * 1000).toLocaleTimeString()}`;

      Logger.info(`Retrieved current weather for ${resolvedLocation}`);

      return {
        content: [
          {
            type: "text",
            text: summary
          },
          {
            type: "text",
            text: `\n**Detailed Data:**\n\`\`\`json\n${JSON.stringify(weatherData, null, 2)}\n\`\`\``
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to get current weather:", error);
      return {
        content: [{
          type: "text",
          text: `❌ Failed to get weather for "${resolvedLocation ?? location}": ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to get weather forecast
 */
server.registerTool(
  "weather_forecast",
  {
    title: "Get Weather Forecast",
    description: "Get multi-day weather forecast for a location",
    inputSchema: ForecastInputSchema
  },
  async ({ location, days = 5, units = "metric" }) => {
    try {
      const resolvedLocation = location || await getUserLocation() || 'London,UK';
      const url = `${OPENWEATHER_BASE_URL}/forecast?q=${encodeURIComponent(resolvedLocation)}&appid=${OPENWEATHER_API_KEY}&units=${units}&cnt=${days * 8}`;
      const data = await makeWeatherRequest(url);

      const dailyForecasts = groupByDay(data.list);
      const forecastSummary = buildForecastTable(
        data.city.name,
        data.city.country,
        dailyForecasts,
        days,
        (t) => formatTemperature(t, units),
        (s) => formatWindSpeed(s, units)
      );

      Logger.info(`Retrieved ${days}-day forecast for ${resolvedLocation}`);

      const detailedData = {
        location: data.city.name,
        country: data.city.country,
        forecast_days: days,
        daily_summaries: Array.from(dailyForecasts.entries()).slice(0, days).map(([dateKey, dayData]) => {
          const { minT, maxT, pop } = dayStats(dayData);
          return { date: dateKey, min_temp: minT, max_temp: maxT, conditions: dayData[0].weather[0].description, precipitation_chance: pop };
        })
      };

      return {
        content: [
          {
            type: "text",
            text: forecastSummary
          },
          {
            type: "text",
            text: `\n**Summary Data:**\n\`\`\`json\n${JSON.stringify(detailedData, null, 2)}\n\`\`\``
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to get weather forecast:", error);
      return {
        content: [{
          type: "text",
          text: `❌ Failed to get forecast for "${resolvedLocation ?? location}": ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool for geocoding locations
 */
server.registerTool(
  "geocode_location",
  {
    title: "Geocode Location",
    description: "Convert location name to coordinates and get location details",
    inputSchema: GeocodingInputSchema
  },
  async ({ location, limit = 5 }) => {
    try {
      const results = await geocodeLocation(location);
      const limitedResults = results.slice(0, limit);

      let summary = `🗺️ **Geocoding Results for "${location}"**\n\n`;
      
      limitedResults.forEach((result, index) => {
        summary += `**${index + 1}. ${result.name}**\n`;
        if (result.state) {
          summary += `📍 ${result.state}, ${result.country}\n`;
        } else {
          summary += `📍 ${result.country}\n`;
        }
        summary += `🌐 Coordinates: ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}\n`;
        if (result.local_names && Object.keys(result.local_names).length > 0) {
          const localNames = Object.entries(result.local_names).slice(0, 3);
          summary += `🗣️ Local names: ${localNames.map(([lang, name]) => `${name} (${lang})`).join(', ')}\n`;
        }
        summary += `\n`;
      });

      Logger.info(`Geocoded location: ${location} (${limitedResults.length} results)`);

      return {
        content: [
          {
            type: "text",
            text: summary
          },
          {
            type: "text",
            text: `\n**Detailed Results:**\n\`\`\`json\n${JSON.stringify(limitedResults, null, 2)}\n\`\`\``
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to geocode location:", error);
      return {
        content: [{
          type: "text",
          text: `❌ Failed to geocode "${location}": ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to get weather alerts (requires One Call API subscription)
 */
server.registerTool(
  "weather_alerts",
  {
    title: "Get Weather Alerts",
    description: "Get weather alerts for specific coordinates (requires One Call API subscription)",
    inputSchema: WeatherAlertsInputSchema
  },
  async ({ lat, lon }) => {
    try {
      const url = `${OPENWEATHER_ONECALL_URL}/onecall?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&exclude=minutely,hourly,daily`;
      const data = await makeWeatherRequest(url);

      if (!data.alerts || data.alerts.length === 0) {
        return {
          content: [{
            type: "text",
            text: `✅ No active weather alerts for coordinates ${lat.toFixed(4)}, ${lon.toFixed(4)}`
          }]
        };
      }

      let alertsSummary = `⚠️ **Weather Alerts for ${lat.toFixed(4)}, ${lon.toFixed(4)}**\n\n`;
      
      data.alerts.forEach((alert: any, index: number) => {
        const startTime = new Date(alert.start * 1000);
        const endTime = new Date(alert.end * 1000);
        
        alertsSummary += `**${index + 1}. ${alert.event}**\n`;
        alertsSummary += `📅 **Start:** ${startTime.toLocaleString()}\n`;
        alertsSummary += `📅 **End:** ${endTime.toLocaleString()}\n`;
        alertsSummary += `🏢 **Source:** ${alert.sender_name}\n`;
        alertsSummary += `📝 **Description:** ${alert.description}\n\n`;
      });

      Logger.info(`Retrieved ${data.alerts.length} weather alerts for coordinates ${lat}, ${lon}`);

      return {
        content: [
          {
            type: "text",
            text: alertsSummary
          },
          {
            type: "text",
            text: `\n**Alert Details:**\n\`\`\`json\n${JSON.stringify(data.alerts, null, 2)}\n\`\`\``
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to get weather alerts:", error);
      return {
        content: [{
          type: "text",
          text: `❌ Failed to get weather alerts: ${error instanceof Error ? error.message : 'Unknown error'}\n\n*Note: Weather alerts require a One Call API subscription.*`
        }],
        isError: true
      };
    }
  }
);

/**
 * Start the server
 */
async function main(): Promise<void> {
  try {
    // Validate API key by making a test request
    const testUrl = `${OPENWEATHER_BASE_URL}/weather?q=London&appid=${OPENWEATHER_API_KEY}&units=metric`;
    await makeWeatherRequest(testUrl);
    Logger.info("OpenWeatherMap API key validated successfully");

    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    Logger.info("Weather MCP Server started successfully");
  } catch (error) {
    Logger.error("Failed to start Weather server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
async function shutdown(): Promise<void> {
  try {
    Logger.info("Shutting down Weather MCP Server...");
    process.exit(0);
  } catch (error) {
    Logger.error("Error during shutdown:", error);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  Logger.error("Unhandled server error:", error);
  process.exit(1);
});