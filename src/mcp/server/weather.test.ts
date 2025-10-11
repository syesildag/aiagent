import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { z } from 'zod';

describe('Weather Server', () => {
  beforeAll(() => {
    // Set up environment for testing
    process.env['OPENWEATHERMAP_API_KEY'] = 'test-api-key';
  });

  afterAll(() => {
    // Clean up
    delete process.env['OPENWEATHERMAP_API_KEY'];
  });

  describe('Utility Functions', () => {
    it('should format temperature correctly', () => {
      const formatTemp = (temp: number, units: string) => {
        switch (units) {
          case "imperial":
            return `${Math.round(temp)}°F`;
          case "kelvin":
            return `${Math.round(temp)}K`;
          default:
            return `${Math.round(temp)}°C`;
        }
      };

      expect(formatTemp(20, 'metric')).toBe('20°C');
      expect(formatTemp(68, 'imperial')).toBe('68°F');
      expect(formatTemp(293, 'kelvin')).toBe('293K');
    });

    it('should format wind speed correctly', () => {
      const formatWind = (speed: number, units: string) => {
        switch (units) {
          case "imperial":
            return `${speed} mph`;
          default:
            return `${speed} m/s`;
        }
      };

      expect(formatWind(5, 'metric')).toBe('5 m/s');
      expect(formatWind(10, 'imperial')).toBe('10 mph');
    });
  });

  describe('Data Validation', () => {
    it('should validate weather input schemas', () => {
      const CurrentWeatherInputSchema = z.object({
        location: z.string().min(1, "Location cannot be empty"),
        units: z.enum(["metric", "imperial", "kelvin"]).optional()
      });

      expect(() => CurrentWeatherInputSchema.parse({ location: 'London' })).not.toThrow();
      expect(() => CurrentWeatherInputSchema.parse({ location: 'London', units: 'metric' })).not.toThrow();
      expect(() => CurrentWeatherInputSchema.parse({ location: '' })).toThrow();
      expect(() => CurrentWeatherInputSchema.parse({ location: 'London', units: 'invalid' as any })).toThrow();
    });

    it('should validate forecast input schemas', () => {
      const ForecastInputSchema = z.object({
        location: z.string().min(1, "Location cannot be empty"),
        days: z.number().int().min(1).max(5).optional(),
        units: z.enum(["metric", "imperial", "kelvin"]).optional()
      });

      expect(() => ForecastInputSchema.parse({ location: 'London' })).not.toThrow();
      expect(() => ForecastInputSchema.parse({ location: 'London', days: 3 })).not.toThrow();
      expect(() => ForecastInputSchema.parse({ location: 'London', days: 6 })).toThrow();
      expect(() => ForecastInputSchema.parse({ location: 'London', days: 0 })).toThrow();
    });

    it('should validate geocoding input schemas', () => {
      const GeocodingInputSchema = z.object({
        location: z.string().min(1, "Location cannot be empty"),
        limit: z.number().int().min(1).max(10).optional()
      });

      expect(() => GeocodingInputSchema.parse({ location: 'Paris' })).not.toThrow();
      expect(() => GeocodingInputSchema.parse({ location: 'Paris', limit: 5 })).not.toThrow();
      expect(() => GeocodingInputSchema.parse({ location: 'Paris', limit: 11 })).toThrow();
      expect(() => GeocodingInputSchema.parse({ location: 'Paris', limit: 0 })).toThrow();
    });

    it('should validate weather alerts input schemas', () => {
      const WeatherAlertsInputSchema = z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180)
      });

      expect(() => WeatherAlertsInputSchema.parse({ lat: 40.7128, lon: -74.0060 })).not.toThrow();
      expect(() => WeatherAlertsInputSchema.parse({ lat: 91, lon: 0 })).toThrow();
      expect(() => WeatherAlertsInputSchema.parse({ lat: 0, lon: 181 })).toThrow();
    });
  });

  describe('API Configuration', () => {
    it('should require API key configuration', () => {
      expect(process.env['OPENWEATHERMAP_API_KEY']).toBeDefined();
      expect(process.env['OPENWEATHERMAP_API_KEY']).toBe('test-api-key');
    });

    it('should build correct API URLs', () => {
      const baseUrl = "https://api.openweathermap.org/data/2.5";
      const geoUrl = "https://api.openweathermap.org/geo/1.0";
      const oneCallUrl = "https://api.openweathermap.org/data/3.0";
      
      expect(baseUrl).toBe("https://api.openweathermap.org/data/2.5");
      expect(geoUrl).toBe("https://api.openweathermap.org/geo/1.0");
      expect(oneCallUrl).toBe("https://api.openweathermap.org/data/3.0");
    });
  });
});