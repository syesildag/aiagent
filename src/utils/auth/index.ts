import Logger from '../logger';
import { updateEnvVariable, readEnvVariable } from '../envManager';

interface OAuthTokenInfo {
  type: 'oauth';
  refresh: string; // GitHub OAuth token
  access: string;  // Copilot API token
  expires: number; // Expiry timestamp for Copilot token
}

interface ApiKeyInfo {
  type: 'apikey';
  key: string;
}

type AuthInfo = OAuthTokenInfo | ApiKeyInfo;

/**
 * Environment variable-based authentication storage system using envManager
 */
export class Auth {
  /**
   * Generate environment variable name for a service
   */
  private static getEnvKey(service: string): string {
    return `AUTH_${service.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  }

  /**
   * Store authentication information for a service
   */
  static async set(service: string, authInfo: AuthInfo): Promise<void> {
    const envKey = Auth.getEnvKey(service);
    const serializedAuth = JSON.stringify(authInfo);
    
    updateEnvVariable(envKey, serializedAuth);
    Logger.debug(`Stored auth info for service: ${service} in environment variable: ${envKey}`);
  }

  /**
   * Get authentication information for a service
   */
  static async get(service: string): Promise<AuthInfo | undefined> {
    const envKey = Auth.getEnvKey(service);
    const serializedAuth = readEnvVariable(envKey) || process.env[envKey];
    
    if (!serializedAuth) {
      return undefined;
    }

    try {
      return JSON.parse(serializedAuth);
    } catch (error) {
      Logger.warn(`Failed to parse auth data for service ${service}: ${error}`);
      return undefined;
    }
  }

  /**
   * Remove authentication information for a service
   */
  static async remove(service: string): Promise<void> {
    const envKey = Auth.getEnvKey(service);
    
    // Set empty value to remove it
    updateEnvVariable(envKey, '');
    
    // Also remove from process.env
    delete process.env[envKey];
    
    Logger.debug(`Removed auth info for service: ${service} from environment variable: ${envKey}`);
  }

  /**
   * Check if a service has stored authentication
   */
  static async has(service: string): Promise<boolean> {
    const authInfo = await Auth.get(service);
    return !!authInfo;
  }

  /**
   * List all services with stored authentication
   */
  static async list(): Promise<string[]> {
    const services: string[] = [];
    const authPrefix = 'AUTH_';
    
    // Check all environment variables for AUTH_ prefix
    for (const key in process.env) {
      if (key.startsWith(authPrefix) && process.env[key]) {
        // Convert AUTH_SERVICE_NAME back to service-name
        const serviceName = key
          .substring(authPrefix.length)
          .toLowerCase()
          .replace(/_/g, '-');
        services.push(serviceName);
      }
    }
    
    return services;
  }

  /**
   * Clear all stored authentication data
   */
  static async clear(): Promise<void> {
    const services = await Auth.list();
    
    for (const service of services) {
      await Auth.remove(service);
    }
    
    Logger.debug('Cleared all auth data from environment variables');
  }
}