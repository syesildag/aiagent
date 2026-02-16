# Weather MCP Server Configuration

## Overview
The Weather MCP Server provides comprehensive weather information using the OpenWeatherMap API. It includes current weather, forecasts, weather alerts, and geocoding capabilities.

## Prerequisites

### 1. OpenWeatherMap API Key
You need to obtain a free API key from [OpenWeatherMap](https://openweathermap.org/api):

1. Create an account at https://openweathermap.org/users/sign_up
2. Navigate to API Keys section
3. Generate a new API key
4. Add it to your `.env` file:

```env
OPENWEATHERMAP_API_KEY=your_api_key_here
```

### 2. Optional: One Call API Subscription
For weather alerts and advanced features, consider upgrading to the One Call API subscription.

## MCP Server Configuration

Add the weather server to your `mcp-servers.json`:

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["dist/mcp/server/weather.js"],
      "env": {
        "OPENWEATHERMAP_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Or if you prefer to use the system environment variable:

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["dist/mcp/server/weather.js"]
    }
  }
}
```

## Available Tools

### 1. current_weather
Get current weather conditions for a location.

**Parameters:**
- `location` (required): City name, state/country code (e.g., "London,UK", "New York,NY,US")
- `units` (optional): "metric" (°C), "imperial" (°F), or "kelvin" (K)

**Example:**
```typescript
{
  "location": "London,UK",
  "units": "metric"
}
```

### 2. weather_forecast
Get multi-day weather forecast.

**Parameters:**
- `location` (required): City name, state/country code
- `days` (optional): Number of forecast days (1-5, default: 5)
- `units` (optional): Temperature units

**Example:**
```typescript
{
  "location": "Tokyo,JP",
  "days": 3,
  "units": "metric"
}
```

### 3. geocode_location
Convert location names to coordinates.

**Parameters:**
- `location` (required): Location to geocode
- `limit` (optional): Maximum results (1-10, default: 5)

**Example:**
```typescript
{
  "location": "Paris",
  "limit": 3
}
```

### 4. weather_alerts
Get weather alerts for specific coordinates (requires One Call API subscription).

**Parameters:**
- `lat` (required): Latitude (-90 to 90)
- `lon` (required): Longitude (-180 to 180)

**Example:**
```typescript
{
  "lat": 40.7128,
  "lon": -74.0060
}
```

## Available Resources

### 1. Weather Dashboard (`weather://dashboard`)
Current weather for major world cities.

### 2. Current Weather (`weather://current/{location}`)
Real-time weather for specific locations.
- Example: `weather://current/London,UK`

### 3. Weather Forecast (`weather://forecast/{location}/{days}`)
Multi-day forecasts for locations.
- Example: `weather://forecast/Tokyo,JP/5`

## Usage Examples

### Using the CLI
```bash
# Get current weather
npm run cli:dev
> What's the weather like in Paris?

# Get a 5-day forecast
> Can you show me the weather forecast for Tokyo for the next 5 days?

# Find coordinates for a city
> What are the coordinates for Sydney, Australia?
```

### Direct Tool Usage
```javascript
const result = await mcpManager.executeTools([{
  server: 'weather',
  tool: 'current_weather',
  arguments: {
    location: 'New York,NY,US',
    units: 'imperial'
  }
}]);
```

## Features

### Weather Data Includes:
- Temperature (current and "feels like")
- Humidity and atmospheric pressure
- Wind speed, direction, and gusts
- Cloud cover and visibility
- Sunrise and sunset times
- Weather conditions and descriptions
- Weather icons for visual representation

### Forecast Features:
- Up to 5-day forecasts
- Daily temperature ranges
- Precipitation probability
- Wind conditions
- Humidity levels

### Location Support:
- City names with country codes
- State/province support for ambiguous cities
- Geocoding for coordinate resolution
- Support for international locations

## Error Handling

The server includes comprehensive error handling:
- Invalid API key detection
- Location not found errors
- API rate limit handling
- Network timeout handling
- Malformed request validation

## Logging

All operations are logged using the central logging system:
- API requests and responses
- Error conditions
- Performance metrics
- Usage statistics

## Rate Limits

OpenWeatherMap free tier includes:
- 1,000 API calls per day
- 60 calls per minute

Consider upgrading for higher usage needs.

## Troubleshooting

### Common Issues:

1. **API Key Invalid**
   - Verify your API key in the .env file
   - Check if the key is active (may take a few hours after creation)

2. **Location Not Found**
   - Try more specific location names (e.g., "London,UK" instead of "London")
   - Use geocoding tool to verify location names

3. **Rate Limit Exceeded**
   - Monitor your API usage
   - Consider upgrading your OpenWeatherMap plan

4. **Network Issues**
   - Check internet connectivity
   - Verify OpenWeatherMap service status

### Debug Mode:
Set `NODE_ENV=development` for detailed logging.