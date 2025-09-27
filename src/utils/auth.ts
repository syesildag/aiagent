import Logger from './logger';
import { updateEnvVariable, readEnvVariable } from './envManager';

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


}