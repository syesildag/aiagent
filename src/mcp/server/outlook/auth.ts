/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import {
    PublicClientApplication,
    InteractionRequiredAuthError,
    AuthenticationResult,
    DeviceCodeRequest,
    ICachePlugin,
    TokenCacheContext,
} from '@azure/msal-node';
import { msalConfig, loginRequest } from './authConfig.js';

// Lazily imported to avoid loading envManager in MCP server context before env is ready
async function getAuth() {
    const { Auth } = await import('../../../utils/auth.js');
    return Auth;
}

const SERVICE_NAME = 'outlook';

/**
 * MSAL cache plugin that persists the token cache to AUTH_OUTLOOK env var (via .env file),
 * mirroring the AUTH_GITHUB_COPILOT pattern used by the GitHub Copilot provider.
 */
function buildCachePlugin(): ICachePlugin {
    return {
        beforeCacheAccess: async (context: TokenCacheContext) => {
            const Auth = await getAuth();
            const stored = await Auth.get(SERVICE_NAME);
            if (stored && stored.type === 'oauth' && stored.refresh) {
                context.tokenCache.deserialize(stored.refresh);
            }
        },
        afterCacheAccess: async (context: TokenCacheContext) => {
            if (!context.cacheHasChanged) return;
            const Auth = await getAuth();
            const serialized = context.tokenCache.serialize();
            const existing = await Auth.get(SERVICE_NAME);
            const access = existing?.type === 'oauth' ? existing.access : '';
            const expires = existing?.type === 'oauth' ? existing.expires : 0;
            await Auth.set(SERVICE_NAME, {
                type: 'oauth',
                refresh: serialized,   // MSAL token cache (contains refresh token)
                access,                // current access token (updated by saveAccessToken)
                expires,
            });
        },
    };
}

export const pca = new PublicClientApplication({
    ...msalConfig,
    cache: { cachePlugin: buildCachePlugin() },
});

// In-process cache to avoid redundant token requests within the same server lifetime
let authResultCache: AuthenticationResult | null = null;

/** Clear the in-process token cache, forcing re-acquisition on the next call. */
export const clearTokenCache = (): void => {
    authResultCache = null;
};

/**
 * Get the access token — returns cached value if still valid, otherwise refreshes.
 */
export const getAccessToken = async (): Promise<string> => {
    if (authResultCache && authResultCache.expiresOn && authResultCache.expiresOn > new Date()) {
        return authResultCache.accessToken;
    }

    const authResult = await acquireToken();
    if (!authResult) {
        throw new Error('Failed to acquire access token');
    }

    authResultCache = authResult;
    await saveAccessToken(authResult);
    return authResult.accessToken;
};

/**
 * Persist the access token and expiry into AUTH_OUTLOOK alongside the MSAL cache.
 */
async function saveAccessToken(result: AuthenticationResult): Promise<void> {
    const Auth = await getAuth();
    const existing = await Auth.get(SERVICE_NAME);
    const refresh = existing?.type === 'oauth' ? existing.refresh : '';
    await Auth.set(SERVICE_NAME, {
        type: 'oauth',
        refresh,
        access: result.accessToken,
        expires: result.expiresOn ? result.expiresOn.getTime() : 0,
    });
}

/**
 * Check if the user is authenticated (has a stored account in the MSAL cache).
 */
export const isAuthenticated = async (): Promise<boolean> => {
    const accounts = await pca.getTokenCache().getAllAccounts();
    return accounts.length > 0;
};

/**
 * Acquire an access token using device code flow for headless/server environments.
 * On first run, prints a URL and code to stderr — visit the URL and enter the code
 * in your browser. Subsequent calls use the cached refresh token silently.
 * Run `npm run cli` and type "outlook" to pre-authenticate before starting the server.
 */
export const acquireToken = async (): Promise<AuthenticationResult | undefined> => {
    const accounts = await pca.getTokenCache().getAllAccounts();

    if (accounts.length === 1) {
        const silentRequest = { account: accounts[0], scopes: loginRequest.scopes };
        return pca.acquireTokenSilent(silentRequest).catch((e) => {
            if (e instanceof InteractionRequiredAuthError) {
                return acquireTokenByDeviceCode();
            }
            throw e;
        }) as Promise<AuthenticationResult | undefined>;
    } else if (accounts.length > 1) {
        throw new Error('Multiple accounts found. Please select an account to use.');
    } else {
        return acquireTokenByDeviceCode();
    }
};

const acquireTokenByDeviceCode = async (): Promise<AuthenticationResult | undefined> => {
    const deviceCodeRequest: DeviceCodeRequest = {
        ...loginRequest,
        deviceCodeCallback: (response) => {
            // Build the message manually — response.message may be undefined in some MSAL versions
            const msg = response.message
                ?? `To sign in, visit ${response.verificationUri} and enter code: ${response.userCode}`;
            // Write to stderr — stdout is reserved for MCP JSON-RPC communication
            process.stderr.write(`\n${msg}\n\n`);
        },
    };
    const result = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
    return result ?? undefined;
};
