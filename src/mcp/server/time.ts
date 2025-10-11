#!/usr/bin/env node

/**
 * MCP Time Server - Time and timezone conversion capabilities
 * 
 * This server provides comprehensive time information and timezone conversion:
 * - Using McpServer for modern MCP implementation
 * - Zod schema validation for type safety
 * - Resource templates with URI patterns for different time data
 * - Comprehensive error handling and logging
 * - Support for current time, timezone conversions, and world clock
 * - IANA timezone support with automatic system timezone detection
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Logger from "../../utils/logger.js";

/**
 * Input schemas for tools with comprehensive validation
 */
const GetCurrentTimeInputSchema = {
  timezone: z.string().optional().describe("IANA timezone name (e.g., 'America/New_York', 'Europe/London'). If not provided, uses system timezone")
};

const ConvertTimeInputSchema = {
  source_timezone: z.string().min(1, "Source timezone cannot be empty").describe("Source IANA timezone name (e.g., 'America/New_York')"),
  time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Time must be in HH:MM format (24-hour)").describe("Time in 24-hour format (HH:MM)"),
  target_timezone: z.string().min(1, "Target timezone cannot be empty").describe("Target IANA timezone name (e.g., 'Europe/London')"),
  date: z.string().optional().describe("Date in YYYY-MM-DD format. If not provided, uses current date")
};

const ListTimezonesInputSchema = {
  region: z.string().optional().describe("Filter by region (e.g., 'America', 'Europe', 'Asia')"),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum number of timezones to return (1-100)")
};

const GetTimezoneInfoInputSchema = {
  timezone: z.string().min(1, "Timezone cannot be empty").describe("IANA timezone name")
};

/**
 * Time data interfaces
 */
interface TimeInfo {
  timezone: string;
  datetime: string;
  iso_string: string;
  unix_timestamp: number;
  utc_offset: string;
  is_dst: boolean;
  timezone_abbreviation: string;
  day_of_week: string;
  day_of_year: number;
  week_of_year: number;
}

interface TimezoneInfo {
  timezone: string;
  region: string;
  country?: string;
  utc_offset: string;
  is_dst: boolean;
  abbreviation: string;
  display_name: string;
}

interface ConversionResult {
  source: TimeInfo;
  target: TimeInfo;
  time_difference: string;
}

/**
 * Utility functions
 */
function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
}

function getSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatTimeInfo(date: Date, timezone: string): TimeInfo {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  });

  const parts = formatter.formatToParts(date);
  const partsMap = parts.reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {} as Record<string, string>);

  const localDateTime = `${partsMap.year}-${partsMap.month}-${partsMap.day} ${partsMap.hour}:${partsMap.minute}:${partsMap.second}`;
  
  // Get UTC offset
  const offsetMs = getTimezoneOffset(date, timezone);
  const offsetHours = Math.floor(Math.abs(offsetMs) / (1000 * 60 * 60));
  const offsetMinutes = Math.floor((Math.abs(offsetMs) % (1000 * 60 * 60)) / (1000 * 60));
  const offsetSign = offsetMs >= 0 ? '+' : '-';
  const utcOffset = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;

  // Check if DST
  const isDST = isDaylightSavingTime(date, timezone);

  // Get day of week and year info
  const dayOfWeek = date.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });
  const dayOfYear = getDayOfYear(date, timezone);
  const weekOfYear = getWeekOfYear(date, timezone);

  return {
    timezone,
    datetime: localDateTime,
    iso_string: date.toISOString(),
    unix_timestamp: Math.floor(date.getTime() / 1000),
    utc_offset: utcOffset,
    is_dst: isDST,
    timezone_abbreviation: partsMap.timeZoneName || 'N/A',
    day_of_week: dayOfWeek,
    day_of_year: dayOfYear,
    week_of_year: weekOfYear
  };
}

function getTimezoneOffset(date: Date, timezone: string): number {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return tzDate.getTime() - utcDate.getTime();
}

function isDaylightSavingTime(date: Date, timezone: string): boolean {
  const january = new Date(date.getFullYear(), 0, 1);
  const july = new Date(date.getFullYear(), 6, 1);
  
  const janOffset = getTimezoneOffset(january, timezone);
  const julOffset = getTimezoneOffset(july, timezone);
  const currentOffset = getTimezoneOffset(date, timezone);
  
  return currentOffset !== Math.max(janOffset, julOffset);
}

function getDayOfYear(date: Date, timezone: string): number {
  const localDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const start = new Date(localDate.getFullYear(), 0, 0);
  const diff = localDate.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getWeekOfYear(date: Date, timezone: string): number {
  const localDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const start = new Date(localDate.getFullYear(), 0, 1);
  const days = Math.floor((localDate.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + start.getDay() + 1) / 7);
}

function getAllTimezones(): string[] {
  // Get all available timezones from Intl
  const timezones: string[] = [];
  
  // Common timezone patterns
  const regions = ['Africa', 'America', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific'];
  
  // Generate a comprehensive list of timezones
  const commonTimezones = [
    // Major cities and regions
    'UTC', 'GMT',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
    'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Moscow', 'Europe/Istanbul',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Seoul',
    'Asia/Mumbai', 'Asia/Dubai', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Manila',
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Brisbane',
    'Pacific/Auckland', 'Pacific/Honolulu', 'Pacific/Fiji',
    'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi'
  ];

  // Validate each timezone
  for (const tz of commonTimezones) {
    if (isValidTimezone(tz)) {
      timezones.push(tz);
    }
  }

  return timezones.sort();
}

function formatTimeDifference(sourceTime: Date, targetTime: Date): string {
  const diffMs = targetTime.getTime() - sourceTime.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  if (diffHours === 0) {
    return "Same time";
  } else if (diffHours > 0) {
    const hours = Math.floor(diffHours);
    const minutes = Math.floor((diffHours - hours) * 60);
    return `+${hours}h ${minutes > 0 ? minutes + 'm' : ''} ahead`.trim();
  } else {
    const hours = Math.floor(Math.abs(diffHours));
    const minutes = Math.floor((Math.abs(diffHours) - hours) * 60);
    return `-${hours}h ${minutes > 0 ? minutes + 'm' : ''} behind`.trim();
  }
}

function parseTimeString(timeStr: string, date: Date, timezone: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const localDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  localDate.setHours(hours, minutes, 0, 0);
  
  // Convert back to UTC considering the timezone
  const utcTime = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzTime = new Date(localDate.toLocaleString('en-US', { timeZone: timezone }));
  const offset = tzTime.getTime() - utcTime.getTime();
  
  return new Date(localDate.getTime() - offset);
}

/**
 * Create a modern MCP server using the high-level McpServer API
 */
const server = new McpServer({
  name: "time-server",
  version: "1.0.0"
});

/**
 * Register world clock resource - current time in major cities
 */
server.registerResource(
  "world-clock",
  "time://world-clock",
  {
    title: "World Clock",
    description: "Current time in major world cities",
    mimeType: "application/json"
  },
  async () => {
    try {
      const majorCities = [
        { city: "New York", timezone: "America/New_York" },
        { city: "Los Angeles", timezone: "America/Los_Angeles" },
        { city: "London", timezone: "Europe/London" },
        { city: "Paris", timezone: "Europe/Paris" },
        { city: "Tokyo", timezone: "Asia/Tokyo" },
        { city: "Sydney", timezone: "Australia/Sydney" },
        { city: "Dubai", timezone: "Asia/Dubai" },
        { city: "Singapore", timezone: "Asia/Singapore" },
        { city: "Mumbai", timezone: "Asia/Mumbai" },
        { city: "São Paulo", timezone: "America/Sao_Paulo" }
      ];

      const now = new Date();
      const worldTimes = majorCities.map(({ city, timezone }) => {
        try {
          const timeInfo = formatTimeInfo(now, timezone);
          return {
            city,
            timezone,
            local_time: timeInfo.datetime,
            utc_offset: timeInfo.utc_offset,
            is_dst: timeInfo.is_dst,
            abbreviation: timeInfo.timezone_abbreviation
          };
        } catch (error) {
          Logger.warn(`Failed to get time for ${city}: ${error}`);
          return null;
        }
      }).filter(time => time !== null);

      return {
        contents: [{
          uri: "time://world-clock",
          mimeType: "application/json",
          text: JSON.stringify({
            timestamp: now.toISOString(),
            system_timezone: getSystemTimezone(),
            cities: worldTimes
          }, null, 2)
        }]
      };
    } catch (error) {
      Logger.error("Failed to fetch world clock:", error);
      throw error;
    }
  }
);

/**
 * Register dynamic time resource for specific timezones
 */
server.registerResource(
  "current-time",
  new ResourceTemplate("time://current/{timezone}", {
    list: async () => {
      const commonTimezones = [
        "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris",
        "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney", "Asia/Dubai"
      ];

      return {
        resources: commonTimezones.map(timezone => ({
          uri: `time://current/${encodeURIComponent(timezone)}`,
          name: `Current time in ${timezone}`,
          description: `Real-time information for ${timezone}`,
          mimeType: "application/json"
        }))
      };
    }
  }),
  {
    title: "Current Time",
    description: "Current time and timezone information for a specific timezone"
  },
  async (uri, { timezone }) => {
    try {
      const timezoneStr = Array.isArray(timezone) ? timezone[0] : timezone;
      const decodedTimezone = decodeURIComponent(timezoneStr);
      
      if (!isValidTimezone(decodedTimezone)) {
        throw new Error(`Invalid timezone: ${decodedTimezone}`);
      }

      const now = new Date();
      const timeInfo = formatTimeInfo(now, decodedTimezone);

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(timeInfo, null, 2)
        }]
      };
    } catch (error) {
      Logger.error(`Failed to get current time for ${timezone}:`, error);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            timezone: Array.isArray(timezone) ? timezone[0] : timezone
          }, null, 2)
        }]
      };
    }
  }
);

/**
 * Register timezone info resource
 */
server.registerResource(
  "timezone-info",
  new ResourceTemplate("time://timezone/{timezone}", {
    list: async () => {
      const popularTimezones = getAllTimezones().slice(0, 20);

      return {
        resources: popularTimezones.map(timezone => ({
          uri: `time://timezone/${encodeURIComponent(timezone)}`,
          name: `Timezone info for ${timezone}`,
          description: `Detailed timezone information for ${timezone}`,
          mimeType: "application/json"
        }))
      };
    }
  }),
  {
    title: "Timezone Information",
    description: "Detailed information about a specific timezone"
  },
  async (uri, { timezone }) => {
    try {
      const timezoneStr = Array.isArray(timezone) ? timezone[0] : timezone;
      const decodedTimezone = decodeURIComponent(timezoneStr);
      
      if (!isValidTimezone(decodedTimezone)) {
        throw new Error(`Invalid timezone: ${decodedTimezone}`);
      }

      const now = new Date();
      const timeInfo = formatTimeInfo(now, decodedTimezone);
      
      const region = decodedTimezone.split('/')[0];
      const location = decodedTimezone.split('/').slice(1).join('/');

      const timezoneInfo: TimezoneInfo = {
        timezone: decodedTimezone,
        region,
        utc_offset: timeInfo.utc_offset,
        is_dst: timeInfo.is_dst,
        abbreviation: timeInfo.timezone_abbreviation,
        display_name: `${location.replace(/_/g, ' ')} (${region})`
      };

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            ...timezoneInfo,
            current_time: timeInfo
          }, null, 2)
        }]
      };
    } catch (error) {
      Logger.error(`Failed to get timezone info for ${timezone}:`, error);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            timezone: Array.isArray(timezone) ? timezone[0] : timezone
          }, null, 2)
        }]
      };
    }
  }
);

/**
 * Tool to get current time in a specific timezone
 */
server.registerTool(
  "get_current_time",
  {
    title: "Get Current Time",
    description: "Get current time in a specific timezone or system timezone",
    inputSchema: GetCurrentTimeInputSchema
  },
  async ({ timezone }) => {
    try {
      const targetTimezone = timezone || getSystemTimezone();
      
      if (!isValidTimezone(targetTimezone)) {
        throw new Error(`Invalid timezone: ${targetTimezone}`);
      }

      const now = new Date();
      const timeInfo = formatTimeInfo(now, targetTimezone);

      const summary = `🕐 **Current Time**

📍 **Timezone:** ${targetTimezone}
🕐 **Local Time:** ${timeInfo.datetime}
🌍 **UTC Offset:** ${timeInfo.utc_offset}
📅 **Day:** ${timeInfo.day_of_week}
🏷️ **Abbreviation:** ${timeInfo.timezone_abbreviation}
${timeInfo.is_dst ? '☀️ **Daylight Saving:** Active' : '❄️ **Standard Time:** Active'}

📊 **Additional Info:**
• Day of year: ${timeInfo.day_of_year}
• Week of year: ${timeInfo.week_of_year}
• Unix timestamp: ${timeInfo.unix_timestamp}`;

      Logger.info(`Retrieved current time for timezone: ${targetTimezone}`);

      return {
        content: [
          {
            type: "text",
            text: summary
          },
          {
            type: "text",
            text: `\n**Detailed Data:**\n\`\`\`json\n${JSON.stringify(timeInfo, null, 2)}\n\`\`\``
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to get current time:", error);
      return {
        content: [{
          type: "text",
          text: `❌ Failed to get current time: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to convert time between timezones
 */
server.registerTool(
  "convert_time",
  {
    title: "Convert Time Between Timezones",
    description: "Convert time from source timezone to target timezone",
    inputSchema: ConvertTimeInputSchema
  },
  async ({ source_timezone, time, target_timezone, date }) => {
    try {
      if (!isValidTimezone(source_timezone)) {
        throw new Error(`Invalid source timezone: ${source_timezone}`);
      }
      
      if (!isValidTimezone(target_timezone)) {
        throw new Error(`Invalid target timezone: ${target_timezone}`);
      }

      // Use provided date or current date
      const baseDate = date ? new Date(date) : new Date();
      if (isNaN(baseDate.getTime())) {
        throw new Error(`Invalid date format: ${date}. Use YYYY-MM-DD format.`);
      }

      // Parse the time in the source timezone
      const sourceTime = parseTimeString(time, baseDate, source_timezone);
      
      // Get time info for both timezones
      const sourceInfo = formatTimeInfo(sourceTime, source_timezone);
      const targetInfo = formatTimeInfo(sourceTime, target_timezone);
      
      const timeDifference = formatTimeDifference(
        new Date(`1970-01-01T${time}:00`),
        new Date(`1970-01-01T${targetInfo.datetime.split(' ')[1]}`)
      );

      const conversionResult: ConversionResult = {
        source: sourceInfo,
        target: targetInfo,
        time_difference: timeDifference
      };

      const summary = `🔄 **Time Conversion**

📍 **Source:** ${source_timezone}
🕐 **Source Time:** ${sourceInfo.datetime}
🏷️ **Source Abbreviation:** ${sourceInfo.timezone_abbreviation}

📍 **Target:** ${target_timezone}  
🕐 **Target Time:** ${targetInfo.datetime}
🏷️ **Target Abbreviation:** ${targetInfo.timezone_abbreviation}

⏰ **Time Difference:** ${timeDifference}
📅 **Date:** ${baseDate.toDateString()}

${sourceInfo.is_dst ? '☀️ Source DST: Active' : '❄️ Source DST: Inactive'} | ${targetInfo.is_dst ? '☀️ Target DST: Active' : '❄️ Target DST: Inactive'}`;

      Logger.info(`Converted time from ${source_timezone} to ${target_timezone}`);

      return {
        content: [
          {
            type: "text",
            text: summary
          },
          {
            type: "text",
            text: `\n**Conversion Details:**\n\`\`\`json\n${JSON.stringify(conversionResult, null, 2)}\n\`\`\``
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to convert time:", error);
      return {
        content: [{
          type: "text",
          text: `❌ Failed to convert time: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to list available timezones
 */
server.registerTool(
  "list_timezones",
  {
    title: "List Available Timezones",
    description: "Get a list of available IANA timezones, optionally filtered by region",
    inputSchema: ListTimezonesInputSchema
  },
  async ({ region, limit = 50 }) => {
    try {
      let timezones = getAllTimezones();
      
      if (region) {
        const regionLower = region.toLowerCase();
        timezones = timezones.filter(tz => 
          tz.toLowerCase().startsWith(regionLower + '/') ||
          tz.toLowerCase().includes(regionLower)
        );
      }

      const limitedTimezones = timezones.slice(0, limit);
      
      let summary = `🌍 **Available Timezones**\n\n`;
      
      if (region) {
        summary += `📍 **Filtered by region:** ${region}\n`;
      }
      
      summary += `📊 **Showing ${limitedTimezones.length} of ${timezones.length} timezones**\n\n`;

      // Group by region
      const groupedByRegion: Record<string, string[]> = {};
      
      limitedTimezones.forEach(tz => {
        const region = tz.includes('/') ? tz.split('/')[0] : 'Other';
        if (!groupedByRegion[region]) {
          groupedByRegion[region] = [];
        }
        groupedByRegion[region].push(tz);
      });

      Object.entries(groupedByRegion).sort().forEach(([region, zones]) => {
        summary += `**${region}** (${zones.length}):\n`;
        zones.forEach(zone => {
          summary += `• ${zone}\n`;
        });
        summary += '\n';
      });

      Logger.info(`Listed ${limitedTimezones.length} timezones${region ? ` for region: ${region}` : ''}`);

      return {
        content: [
          {
            type: "text",
            text: summary
          },
          {
            type: "text",
            text: `\n**Raw Data:**\n\`\`\`json\n${JSON.stringify({
              total_available: timezones.length,
              showing: limitedTimezones.length,
              filter_region: region || null,
              timezones: limitedTimezones
            }, null, 2)}\n\`\`\``
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to list timezones:", error);
      return {
        content: [{
          type: "text",
          text: `❌ Failed to list timezones: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to get detailed timezone information
 */
server.registerTool(
  "get_timezone_info",
  {
    title: "Get Timezone Information",
    description: "Get detailed information about a specific timezone",
    inputSchema: GetTimezoneInfoInputSchema
  },
  async ({ timezone }) => {
    try {
      if (!isValidTimezone(timezone)) {
        throw new Error(`Invalid timezone: ${timezone}`);
      }

      const now = new Date();
      const timeInfo = formatTimeInfo(now, timezone);
      
      const region = timezone.includes('/') ? timezone.split('/')[0] : 'Other';
      const location = timezone.includes('/') ? timezone.split('/').slice(1).join('/').replace(/_/g, ' ') : timezone;

      // Get DST transition dates (approximate)
      const currentYear = now.getFullYear();
      const january = new Date(currentYear, 0, 1);
      const july = new Date(currentYear, 6, 1);
      
      const janInfo = formatTimeInfo(january, timezone);
      const julInfo = formatTimeInfo(july, timezone);
      
      const hasDST = janInfo.utc_offset !== julInfo.utc_offset;

      const summary = `🌍 **Timezone Information**

📍 **Timezone:** ${timezone}
🗺️ **Region:** ${region}
📍 **Location:** ${location}
🕐 **Current Time:** ${timeInfo.datetime}
🌍 **UTC Offset:** ${timeInfo.utc_offset}
🏷️ **Abbreviation:** ${timeInfo.timezone_abbreviation}

${timeInfo.is_dst ? '☀️ **Currently:** Daylight Saving Time' : '❄️ **Currently:** Standard Time'}
${hasDST ? '🔄 **DST Support:** Yes' : '🚫 **DST Support:** No'}

📊 **Current Details:**
• Day of week: ${timeInfo.day_of_week}
• Day of year: ${timeInfo.day_of_year}
• Week of year: ${timeInfo.week_of_year}
• Unix timestamp: ${timeInfo.unix_timestamp}

📅 **Seasonal Offsets:**
• January (${janInfo.is_dst ? 'DST' : 'Standard'}): ${janInfo.utc_offset}
• July (${julInfo.is_dst ? 'DST' : 'Standard'}): ${julInfo.utc_offset}`;

      Logger.info(`Retrieved timezone info for: ${timezone}`);

      const detailedInfo = {
        timezone,
        region,
        location,
        current_time: timeInfo,
        has_dst: hasDST,
        seasonal_info: {
          january: janInfo,
          july: julInfo
        }
      };

      return {
        content: [
          {
            type: "text",
            text: summary
          },
          {
            type: "text",
            text: `\n**Detailed Information:**\n\`\`\`json\n${JSON.stringify(detailedInfo, null, 2)}\n\`\`\``
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to get timezone info:", error);
      return {
        content: [{
          type: "text",
          text: `❌ Failed to get timezone info: ${error instanceof Error ? error.message : 'Unknown error'}`
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
    // Validate system timezone detection
    const systemTz = getSystemTimezone();
    Logger.info(`System timezone detected: ${systemTz}`);

    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    Logger.info("Time MCP Server started successfully");
  } catch (error) {
    Logger.error("Failed to start Time server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
async function shutdown(): Promise<void> {
  try {
    Logger.info("Shutting down Time MCP Server...");
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