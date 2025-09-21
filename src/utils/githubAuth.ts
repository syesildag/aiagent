import * as fs from 'fs';
import Logger from './logger';

// GitHub OAuth App Client ID
// To set up GitHub OAuth for your application:
// 1. Go to GitHub Settings > Developer settings > OAuth Apps
// 2. Create a new OAuth App with:
//    - Application name: Your app name
//    - Homepage URL: Your app URL (can be localhost for development)
//    - Authorization callback URL: Not needed for device flow
// 3. Copy the Client ID and set it in GITHUB_OAUTH_APP_CLIENT_ID environment variable
// 4. The device flow doesn't require a client secret
const CLIENT_ID = process.env.GITHUB_OAUTH_APP_CLIENT_ID || "Iv1.b507a08c87ecfe98"; // Fallback for development

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Parse HTTP response and handle common error cases
 */
async function parseResponse(response: Response): Promise<any> {
  const data = await response.json();
  
  if (response.ok) {
    return data;
  }
  
  if (response.status === 401) {
    Logger.error('You are not authorized. Run the `login` command.');
    process.exit(1);
  }
  
  Logger.error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  process.exit(1);
}

/**
 * Request device code from GitHub
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'client_id': CLIENT_ID
    })
  });
  
  return parseResponse(response);
}

/**
 * Request access token using device code
 */
async function requestToken(deviceCode: string): Promise<TokenResponse> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'client_id': CLIENT_ID,
      'device_code': deviceCode,
      'grant_type': 'urn:ietf:params:oauth:grant-type:device_code'
    })
  });
  
  return parseResponse(response);
}

/**
 * Poll for access token until user completes authentication
 */
export async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await requestToken(deviceCode);
        
        if (response.error) {
          switch (response.error) {
            case 'authorization_pending':
              // The user has not yet entered the code.
              // Wait, then poll again.
              setTimeout(poll, interval * 1000);
              return;
              
            case 'slow_down':
              // The app polled too fast.
              // Wait for the interval plus 5 seconds, then poll again.
              setTimeout(poll, (interval + 5) * 1000);
              return;
              
            case 'expired_token':
              // The device_code expired, and the process needs to restart.
              reject(new Error('The device code has expired. Please run `login` again.'));
              return;
              
            case 'access_denied':
              // The user cancelled the process. Stop polling.
              reject(new Error('Login cancelled by user.'));
              return;
              
            default:
              reject(new Error(`Authentication error: ${response.error} - ${response.error_description}`));
              return;
          }
        }
        
        if (response.access_token) {
          resolve(response.access_token);
        } else {
          reject(new Error('No access token received'));
        }
      } catch (error) {
        reject(error);
      }
    };
    
    // Start polling
    poll();
  });
}

/**
 * Get GitHub user information using access token
 */
export async function getGitHubUser(token: string): Promise<any> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
    }
  });
  
  return parseResponse(response);
}

/**
 * Complete GitHub OAuth device flow
 */
export async function authenticateWithGitHub(): Promise<string> {
  Logger.info('Starting GitHub authentication...');
  
  // Request device code
  const deviceCodeData = await requestDeviceCode();
  
  console.log(`\nPlease visit: ${deviceCodeData.verification_uri}`);
  console.log(`and enter code: ${deviceCodeData.user_code}\n`);
  
  // Poll for token
  const accessToken = await pollForToken(deviceCodeData.device_code, deviceCodeData.interval);
  
  // Verify token works
  const user = await getGitHubUser(accessToken);
  Logger.info(`Successfully authenticated as: ${user.login}`);
  
  return accessToken;
}

/**
 * Check if user is already authenticated
 */
export async function whoami(): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return null;
  }
  
  try {
    const user = await getGitHubUser(token);
    return user.login;
  } catch (error) {
    Logger.warn('Stored token is invalid or expired');
    return null;
  }
}