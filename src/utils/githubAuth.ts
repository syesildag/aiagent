import z from "zod"
import { Auth } from "./auth/index"
import Logger from './logger';

export namespace AuthGithubCopilot {
  const CLIENT_ID = "Iv1.b507a08c87ecfe98"
  const DEVICE_CODE_URL = "https://github.com/login/device/code"
  const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
  const COPILOT_API_KEY_URL = "https://api.github.com/copilot_internal/v2/token"

  interface DeviceCodeResponse {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }

  interface AccessTokenResponse {
    access_token?: string
    error?: string
    error_description?: string
  }

  interface CopilotTokenResponse {
    token: string
    expires_at: number
    refresh_in: number
    endpoints: {
      api: string
    }
  }

  export async function authorize() {
    const deviceResponse = await fetch(DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "GitHubCopilotChat/0.26.7",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: "read:user",
      }),
    })
    const deviceData: DeviceCodeResponse = await deviceResponse.json()
    return {
      device: deviceData.device_code,
      user: deviceData.user_code,
      verification: deviceData.verification_uri,
      interval: deviceData.interval || 5,
      expiry: deviceData.expires_in,
    }
  }

  export async function poll(device_code: string) {
    const response = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "GitHubCopilotChat/0.26.7",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })

    if (!response.ok) return "failed"

    const data: AccessTokenResponse = await response.json()

    if (data.access_token) {
      // Store the GitHub OAuth token
      await Auth.set("github-copilot", {
        type: "oauth",
        refresh: data.access_token,
        access: "",
        expires: 0,
      })
      return "complete"
    }

    if (data.error === "authorization_pending") return "pending"

    if (data.error) return "failed"

    return "pending"
  }

  export async function access() {
    const info = await Auth.get("github-copilot")
    if (!info || info.type !== "oauth") {
      // Fallback to environment variable if no OAuth stored
      const fallbackToken = process.env.GITHUB_TOKEN
      if (fallbackToken) {
        Logger.debug("Using fallback GITHUB_TOKEN from environment")
        return fallbackToken
      }
      return
    }
    if (info.access && info.expires > Date.now()) return info.access

    // Get new Copilot API token
    const response = await fetch(COPILOT_API_KEY_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${info.refresh}`,
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "Editor-Version": "vscode/1.99.3",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
      },
    })

    if (!response.ok) {
      Logger.warn("Failed to refresh Copilot token, falling back to stored OAuth token")
      return info.refresh
    }

    const tokenData: CopilotTokenResponse = await response.json()

    // Store the Copilot API token
    await Auth.set("github-copilot", {
      type: "oauth",
      refresh: info.refresh,
      access: tokenData.token,
      expires: tokenData.expires_at * 1000,
    })

    return tokenData.token
  }

  export const DeviceCodeError = createNamedError("DeviceCodeError", z.object({}))

  export const TokenExchangeError = createNamedError(
    "TokenExchangeError",
    z.object({
      message: z.string(),
    }),
  )

  export const AuthenticationError = createNamedError(
    "AuthenticationError",
    z.object({
      message: z.string(),
    }),
  )

  export const CopilotTokenError = createNamedError(
    "CopilotTokenError",
    z.object({
      message: z.string(),
    }),
  )
}

// Simple NamedError implementation
function createNamedError<T extends z.ZodTypeAny>(name: string, schema: T) {
  return class extends Error {
    name = name
    data: z.infer<T>
    
    constructor(data: z.infer<T>) {
      super(`${name}: ${JSON.stringify(data)}`)
      this.data = data
    }
  }
}

// Legacy API functions for backward compatibility
export async function requestDeviceCode() {
  const result = await AuthGithubCopilot.authorize()
  return {
    device_code: result.device,
    user_code: result.user,
    verification_uri: result.verification,
    interval: result.interval,
    expires_in: result.expiry,
  }
}

export async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const result = await AuthGithubCopilot.poll(deviceCode)
        
        switch (result) {
          case "complete":
            const token = await AuthGithubCopilot.access()
            if (token) {
              resolve(token)
            } else {
              reject(new Error('No access token received'))
            }
            return
            
          case "pending":
            setTimeout(poll, interval * 1000)
            return
            
          case "failed":
          default:
            reject(new Error('Authentication failed'))
            return
        }
      } catch (error) {
        reject(error)
      }
    }
    
    // Start polling
    poll()
  })
}

export async function authenticateWithGitHub(): Promise<string> {
  Logger.info('Starting GitHub authentication...')
  
  // Request device code
  const deviceCodeData = await requestDeviceCode()
  
  console.log(`\nPlease visit: ${deviceCodeData.verification_uri}`)
  console.log(`and enter code: ${deviceCodeData.user_code}\n`)
  
  // Poll for token
  const accessToken = await pollForToken(deviceCodeData.device_code, deviceCodeData.interval)
  
  Logger.info('Successfully authenticated with GitHub Copilot')
  
  return accessToken
}

export async function getGitHubUser(token: string): Promise<any> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
    }
  })
  
  if (!response.ok) {
    if (response.status === 401) {
      Logger.error('You are not authorized. Run the `login` command.')
      process.exit(1)
    }
    
    const data = await response.json()
    Logger.error(`HTTP ${response.status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
  
  return response.json()
}

export async function whoami(): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return null
  }
  
  try {
    const user = await getGitHubUser(token)
    return user.login
  } catch (error) {
    Logger.warn('Stored token is invalid or expired')
    return null
  }
}

/**
 * Get the best available GitHub token (OAuth Copilot token preferred, fallback to GITHUB_TOKEN)
 */
export async function getBestGitHubToken(): Promise<string | null> {
  try {
    // Try to get OAuth Copilot token first (most up-to-date)
    const copilotToken = await AuthGithubCopilot.access()
    if (copilotToken) {
      return copilotToken
    }
  } catch (error) {
    Logger.debug(`Failed to get Copilot token: ${error}`)
  }
  
  // Fallback to environment variable
  return process.env.GITHUB_TOKEN || null
}