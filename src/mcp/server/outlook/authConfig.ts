import { Configuration, LogLevel } from '@azure/msal-node';
import { config } from '../../../utils/config.js';

/**
 * Configuration object to be passed to MSAL instance on creation.
 * For a full list of MSAL.js configuration parameters, visit:
 * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/configuration.md
 * 
 * Required environment variables:
 * - OUTLOOK_CLIENT_ID: The Application (client) ID from your Azure AD app registration
 * - OUTLOOK_TENANT_ID: Your Azure AD tenant ID
 */
export const msalConfig: Configuration = {
    auth: {
        clientId: config.OUTLOOK_CLIENT_ID!,
        // 'common' supports both personal (hotmail/outlook.com) and work accounts.
        // A specific tenant ID only works for organizational (AAD) accounts and will
        // cause HTTP 401 for personal Microsoft accounts even with a valid token.
        authority: 'https://login.microsoftonline.com/common',
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel: any, message: any, containsPii: any) {
                if (config.DEBUG && !containsPii) {
                    process.stderr.write(`MSAL [${loglevel}]: ${message}\n`);
                }
            },
            piiLoggingEnabled: false,
            logLevel: LogLevel.Error,
        },
    },
};

/**
 * Scopes you add here will be prompted for user consent during sign-in.
 * By default, MSAL.js will add OIDC scopes (openid, profile, email) to any login request.
 * For more information about OIDC scopes, visit: 
 * https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-permissions-and-consent#openid-connect-scopes
 */
export const loginRequest = {
    scopes: [
        'offline_access',  // required to receive a refresh token
        'User.Read',
        'Calendars.Read',
        'Calendars.ReadWrite',
        'Mail.Send',
        'Mail.ReadWrite',
        'Mail.Read',
        'People.Read',
    ],
};