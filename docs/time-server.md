# Time MCP Server

A comprehensive Model Context Protocol server that provides time and timezone conversion capabilities. This server enables LLMs to get current time information and perform timezone conversions using IANA timezone names, with automatic system timezone detection.

## Features

- **Current Time Retrieval**: Get current time in any IANA timezone or system timezone
- **Timezone Conversion**: Convert time between different timezones with DST awareness
- **Timezone Information**: Get detailed information about specific timezones
- **World Clock**: Access current time in major world cities
- **Timezone Listing**: Browse available IANA timezones with filtering
- **Resource Templates**: Dynamic resources for time data with URI patterns
- **Comprehensive Validation**: Zod schema validation for all inputs
- **Error Handling**: Robust error handling with detailed logging

## Available Tools

### `get_current_time`
Get current time in a specific timezone or system timezone.

**Arguments:**
- `timezone` (string, optional): IANA timezone name (e.g., 'America/New_York', 'Europe/London'). If not provided, uses system timezone.

**Example:**
```json
{
  "timezone": "America/New_York"
}
```

### `convert_time`
Convert time between timezones with DST awareness.

**Arguments:**
- `source_timezone` (string, required): Source IANA timezone name (e.g., 'America/New_York')
- `time` (string, required): Time in 24-hour format (HH:MM)
- `target_timezone` (string, required): Target IANA timezone name (e.g., 'Europe/London')
- `date` (string, optional): Date in YYYY-MM-DD format. If not provided, uses current date

**Example:**
```json
{
  "source_timezone": "America/New_York",
  "time": "14:30",
  "target_timezone": "Europe/London",
  "date": "2023-12-25"
}
```

### `list_timezones`
Get a list of available IANA timezones, optionally filtered by region.

**Arguments:**
- `region` (string, optional): Filter by region (e.g., 'America', 'Europe', 'Asia')
- `limit` (number, optional): Maximum number of timezones to return (1-100, default: 50)

**Example:**
```json
{
  "region": "Europe",
  "limit": 25
}
```

### `get_timezone_info`
Get detailed information about a specific timezone including DST rules.

**Arguments:**
- `timezone` (string, required): IANA timezone name

**Example:**
```json
{
  "timezone": "America/New_York"
}
```

## Available Resources

### World Clock (`time://world-clock`)
Returns current time in major world cities with timezone information.

### Current Time (`time://current/{timezone}`)
Dynamic resource template providing current time for any specified timezone.

### Timezone Information (`time://timezone/{timezone}`)
Dynamic resource template providing detailed timezone information including DST rules and current status.

## Configuration

The time server requires no external API keys or configuration. It uses the built-in `Intl` JavaScript API for timezone operations.

Add to your `mcp-servers.json`:

```json
{
  "name": "time",
  "command": "node",
  "args": ["dist/src/mcp/server/time.js"],
  "enabled": true
}
```

## Usage Examples

### Natural Language Queries

The time server works seamlessly with natural language queries through MCP:

- "What's the current time in Tokyo?"
- "Convert 2:30 PM from London to New York time"
- "Is it daylight saving time in California right now?"
- "What time zones are available in Europe?"
- "What's the time difference between Sydney and Berlin?"

### Direct Tool Usage

```typescript
// Get current time in New York
const currentTime = await server.callTool("get_current_time", {
  timezone: "America/New_York"
});

// Convert time between timezones
const conversion = await server.callTool("convert_time", {
  source_timezone: "America/Los_Angeles",
  time: "09:00",
  target_timezone: "Asia/Tokyo"
});

// List European timezones
const timezones = await server.callTool("list_timezones", {
  region: "Europe",
  limit: 20
});
```

## Timezone Support

The server supports all IANA timezone names, including:

- **Americas**: America/New_York, America/Los_Angeles, America/Chicago, etc.
- **Europe**: Europe/London, Europe/Paris, Europe/Berlin, etc.
- **Asia**: Asia/Tokyo, Asia/Shanghai, Asia/Mumbai, etc.
- **Australia**: Australia/Sydney, Australia/Melbourne, etc.
- **Africa**: Africa/Cairo, Africa/Lagos, etc.
- **Pacific**: Pacific/Honolulu, Pacific/Auckland, etc.
- **UTC/GMT**: UTC, GMT

## Features

### Daylight Saving Time (DST) Support
- Automatic DST detection and handling
- Historical and current DST status
- Seasonal offset information

### Comprehensive Time Information
- Local time formatting
- UTC offsets with proper +/- notation
- Timezone abbreviations (EST, PST, GMT, etc.)
- Day of week, day of year, week of year
- Unix timestamps
- ISO 8601 formatted strings

### Error Handling
- Invalid timezone validation
- Malformed time format detection
- Date validation
- Comprehensive error messages
- Graceful fallbacks

## Implementation Details

- **Modern MCP SDK**: Uses latest McpServer class with resource templates
- **TypeScript**: Full type safety with comprehensive interfaces
- **Zod Validation**: Schema validation for all inputs
- **Logging**: Integrated with application logging system
- **Performance**: Efficient timezone calculations using native Intl API
- **Memory Efficient**: No external dependencies for time operations

## Testing

The server includes comprehensive tests covering:
- Input validation for all tools
- Timezone validation logic
- Time format validation
- Date format validation
- Error handling scenarios
- Resource URI generation

Run tests with:
```bash
npm test src/mcp/server/time.test.ts
```

## Architecture

The Time MCP Server follows the same architectural patterns as other MCP servers in the project:

1. **Schema Validation**: All inputs validated with Zod schemas
2. **Resource Templates**: Dynamic URI patterns for flexible resource access
3. **Error Handling**: Comprehensive error handling with proper logging
4. **Modern MCP**: Uses latest MCP SDK features
5. **Type Safety**: Full TypeScript implementation with proper interfaces

## Limitations

- Timezone data is based on the JavaScript runtime's Intl implementation
- Historical timezone rule changes depend on the system's timezone database
- Some very specific or historical timezones may not be available
- Future DST rule changes depend on system updates

The Time MCP Server provides robust, accurate time and timezone functionality suitable for production use in LLM applications requiring temporal information.