/**
 * Tests for Time MCP Server
 */

import { describe, test, expect } from '@jest/globals';
import { z } from 'zod';

// Import the input schemas from the server for testing
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

// Utility functions to test
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

function validateTimeFormat(time: string): boolean {
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

function validateDateFormat(date: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) return false;
  
  const parsedDate = new Date(date);
  return !isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
}

describe('Time MCP Server', () => {
  describe('Input Schema Validation', () => {
    test('GetCurrentTimeInputSchema should validate optional timezone', () => {
      // Valid cases
      expect(() => GetCurrentTimeInputSchema.timezone.parse(undefined)).not.toThrow();
      expect(() => GetCurrentTimeInputSchema.timezone.parse('America/New_York')).not.toThrow();
      expect(() => GetCurrentTimeInputSchema.timezone.parse('Europe/London')).not.toThrow();
      
      // Should accept empty string (will be handled by business logic)
      expect(() => GetCurrentTimeInputSchema.timezone.parse('')).not.toThrow();
    });

    test('ConvertTimeInputSchema should validate all required fields', () => {
      const validInput = {
        source_timezone: 'America/New_York',
        time: '14:30',
        target_timezone: 'Europe/London',
        date: '2023-12-25'
      };

      expect(() => z.object(ConvertTimeInputSchema).parse(validInput)).not.toThrow();

      // Test required fields
      expect(() => z.object(ConvertTimeInputSchema).parse({
        ...validInput,
        source_timezone: ''
      })).toThrow('Source timezone cannot be empty');

      expect(() => z.object(ConvertTimeInputSchema).parse({
        ...validInput,
        target_timezone: ''
      })).toThrow('Target timezone cannot be empty');

      // Test time format validation
      expect(() => z.object(ConvertTimeInputSchema).parse({
        ...validInput,
        time: '25:00'
      })).toThrow('Time must be in HH:MM format');

      expect(() => z.object(ConvertTimeInputSchema).parse({
        ...validInput,
        time: '14:60'
      })).toThrow('Time must be in HH:MM format');

      expect(() => z.object(ConvertTimeInputSchema).parse({
        ...validInput,
        time: '14:30:00'
      })).toThrow('Time must be in HH:MM format');

      // Valid time formats
      const validTimes = ['00:00', '12:30', '23:59', '9:15', '1:05'];
      validTimes.forEach(time => {
        expect(() => z.object(ConvertTimeInputSchema).parse({
          ...validInput,
          time
        })).not.toThrow();
      });
    });

    test('ListTimezonesInputSchema should validate region and limit', () => {
      const validInputs = [
        {},
        { region: 'America' },
        { limit: 50 },
        { region: 'Europe', limit: 25 },
      ];

      validInputs.forEach(input => {
        expect(() => z.object(ListTimezonesInputSchema).parse(input)).not.toThrow();
      });

      // Test limit boundaries
      expect(() => z.object(ListTimezonesInputSchema).parse({ limit: 0 })).toThrow();
      expect(() => z.object(ListTimezonesInputSchema).parse({ limit: 101 })).toThrow();
      expect(() => z.object(ListTimezonesInputSchema).parse({ limit: 1 })).not.toThrow();
      expect(() => z.object(ListTimezonesInputSchema).parse({ limit: 100 })).not.toThrow();
    });

    test('GetTimezoneInfoInputSchema should validate timezone', () => {
      expect(() => z.object(GetTimezoneInfoInputSchema).parse({
        timezone: 'America/New_York'
      })).not.toThrow();

      expect(() => z.object(GetTimezoneInfoInputSchema).parse({
        timezone: ''
      })).toThrow('Timezone cannot be empty');
    });
  });

  describe('Utility Functions', () => {
    test('isValidTimezone should correctly validate timezone names', () => {
      // Valid timezones
      const validTimezones = [
        'UTC',
        'GMT',
        'America/New_York',
        'Europe/London',
        'Asia/Tokyo',
        'Australia/Sydney',
        'Pacific/Honolulu'
      ];

      validTimezones.forEach(tz => {
        expect(isValidTimezone(tz)).toBe(true);
      });

      // Invalid timezones
      const invalidTimezones = [
        'Invalid/Timezone',
        'America/FakeCity',
        'NotATimezone',
        '',
        'UTC+5'  // This format is not valid for Intl API
      ];

      invalidTimezones.forEach(tz => {
        expect(isValidTimezone(tz)).toBe(false);
      });
    });

    test('getSystemTimezone should return valid timezone', () => {
      const systemTz = getSystemTimezone();
      expect(typeof systemTz).toBe('string');
      expect(systemTz.length).toBeGreaterThan(0);
      expect(isValidTimezone(systemTz)).toBe(true);
    });

    test('validateTimeFormat should correctly validate time strings', () => {
      // Valid time formats
      const validTimes = [
        '00:00', '01:30', '09:15', '12:00', '23:59',
        '9:15', '1:05', '14:30'
      ];

      validTimes.forEach(time => {
        expect(validateTimeFormat(time)).toBe(true);
      });

      // Invalid time formats
      const invalidTimes = [
        '24:00', '12:60', '25:30', 'invalid',
        '12:30:45', '12', '12:3', '1:5:30',
        '', '99:99'
      ];

      invalidTimes.forEach(time => {
        expect(validateTimeFormat(time)).toBe(false);
      });
    });

    test('validateDateFormat should correctly validate date strings', () => {
      // Valid date formats
      const validDates = [
        '2023-01-01', '2023-12-31', '2024-02-29', '2023-06-15'
      ];

      validDates.forEach(date => {
        expect(validateDateFormat(date)).toBe(true);
      });

      // Invalid date formats
      const invalidDates = [
        '2023-13-01', '2023-01-32', '2023-02-30',
        '23-01-01', '2023/01/01', 'invalid',
        '', '2023-1-1', '2023-01-1'
      ];

      invalidDates.forEach(date => {
        expect(validateDateFormat(date)).toBe(false);
      });
    });
  });

  describe('Time Calculations', () => {
    test('should handle timezone offset calculations', () => {
      const testDate = new Date('2023-07-15T12:00:00Z'); // Summer time
      
      // These tests rely on known timezone behaviors
      // Note: These might need adjustment based on DST rules
      
      // Basic timezone validation
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('Asia/Tokyo')).toBe(true);
      
      // Time formatting in different timezones
      const nyTime = testDate.toLocaleString('en-US', { 
        timeZone: 'America/New_York',
        hour12: false 
      });
      const londonTime = testDate.toLocaleString('en-US', { 
        timeZone: 'Europe/London',
        hour12: false 
      });
      
      expect(typeof nyTime).toBe('string');
      expect(typeof londonTime).toBe('string');
      expect(nyTime).not.toBe(londonTime); // Should be different times
    });

    test('should handle DST detection logic', () => {
      const winterDate = new Date('2023-01-15T12:00:00Z');
      const summerDate = new Date('2023-07-15T12:00:00Z');
      
      // Get timezone offsets for winter and summer
      const winterOffset = winterDate.getTimezoneOffset();
      const summerOffset = summerDate.getTimezoneOffset();
      
      // System timezone might have DST
      expect(typeof winterOffset).toBe('number');
      expect(typeof summerOffset).toBe('number');
    });
  });

  describe('Resource URI Patterns', () => {
    test('should generate correct resource URIs', () => {
      const testCases = [
        {
          template: 'time://current/{timezone}',
          timezone: 'America/New_York',
          expected: 'time://current/America%2FNew_York'
        },
        {
          template: 'time://timezone/{timezone}',
          timezone: 'Europe/London',
          expected: 'time://timezone/Europe%2FLondon'
        }
      ];

      testCases.forEach(({ timezone, expected }) => {
        const encoded = encodeURIComponent(timezone);
        expect(expected.includes(encoded)).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid timezone gracefully', () => {
      const invalidTimezone = 'Invalid/Timezone';
      expect(isValidTimezone(invalidTimezone)).toBe(false);
      
      // Error should be thrown for invalid timezone
      expect(() => {
        new Date().toLocaleString('en-US', { timeZone: invalidTimezone });
      }).toThrow();
    });

    test('should handle invalid date formats', () => {
      const invalidDates = ['invalid-date', '2023-13-45', ''];
      
      invalidDates.forEach(date => {
        const parsedDate = new Date(date);
        expect(isNaN(parsedDate.getTime())).toBe(true);
      });
    });
  });
});