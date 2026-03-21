# Outlook MCP Server

## Overview

The Outlook MCP server connects the AI agent to Microsoft 365 (Outlook, Calendar) via the [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/overview). It enables the agent to manage email, calendar events, and people lookups without leaving the chat interface.

Authentication uses the **MSAL device code flow** — designed for headless/server environments. On first use, the server prints a URL and short code to paste into any browser. Subsequent calls use a cached refresh token silently.

## Prerequisites

- A Microsoft account (personal `@outlook.com` / `@hotmail.com`, or a work/school Azure AD account)
- An **Azure AD app registration** with the required API permissions (see below)
- `OUTLOOK_CLIENT_ID` set in `.env`

## Azure AD App Registration

### 1. Create the app

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps)
2. Click **New registration**
3. Name: anything (e.g. `aiagent-outlook`)
4. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (`common` tenant — required for personal accounts)
5. Redirect URI: leave blank (not needed for device code flow)
6. Click **Register**

Copy the **Application (client) ID** — this is your `OUTLOOK_CLIENT_ID`.

### 2. Add API permissions

Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add:

| Permission | Purpose |
|---|---|
| `User.Read` | Read signed-in user profile |
| `Calendars.Read` | List and read calendar events |
| `Calendars.ReadWrite` | Create, update, delete calendar events |
| `Mail.Read` | Read email messages |
| `Mail.ReadWrite` | Delete emails, mark as read/unread, create drafts |
| `Mail.Send` | Send email |
| `People.Read` | Search for people (colleagues, contacts) |
| `offline_access` | Receive refresh token for silent re-authentication |

Click **Grant admin consent** if your tenant requires it (for personal accounts this is not needed).

### 3. Enable public client flows

Under **Authentication → Advanced settings**, set **Allow public client flows** to **Yes**. This enables device code flow for a public (non-secret) client.

## Configuration

### Environment variables

```bash
# Required
OUTLOOK_CLIENT_ID=your_application_client_id_from_azure

# Auto-managed — do not edit manually
# Populated after running the "outlook" CLI command
AUTH_OUTLOOK={"type":"oauth","refresh":"<msal-cache>","access":"<token>","expires":...}
```

Add to `.env`:

```bash
OUTLOOK_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### mcp-servers.json

The server is pre-configured in `mcp-servers.json`:

```json
{
  "name": "outlook",
  "command": "node",
  "args": ["dist/src/mcp/server/outlook/index.js"],
  "env": {},
  "enabled": true
}
```

Set `"enabled": true` to activate it.

## First-Time Authentication

Run the CLI and type `outlook`:

```
npm run cli

> outlook

=== Outlook / Microsoft Graph Authentication ===
Starting device code authentication...
A URL and code will be printed below — open the URL and enter the code.

To sign in, visit https://microsoft.com/devicelogin and enter code: ABCD-1234

✅ Outlook authenticated successfully! (account: you@example.com)
Token cached to disk. The outlook MCP server will use it automatically.
```

The MSAL token cache (including refresh token) is serialized and stored in `AUTH_OUTLOOK` in your `.env` file. Future server starts acquire tokens silently.

## Available Tools

All tools are prefixed `outlook_` when called by the agent.

### Calendar

| Tool | Description |
|---|---|
| `listCalendarEvents` | List events for a time range |
| `createCalendarEvent` | Create a new calendar event |
| `getCalendarEvent` | Get details of a specific event |
| `updateCalendarEvent` | Update an existing event |
| `deleteCalendarEvent` | Delete a calendar event |
| `addAttendeesToCalendarEvent` | Add attendees to an existing event (merges, avoids duplicates) |

### Scheduling

| Tool | Description |
|---|---|
| `getSchedule` | Get free/busy schedule for one or more users |
| `findMeetingTimes` | Find available meeting slots for a group of attendees |

### Email

| Tool | Description |
|---|---|
| `listEmails` | List emails from a folder (default: inbox) |
| `getEmail` | Get a specific email message |
| `sendEmail` | Send an email immediately |
| `createDraft` | Save a draft without sending |
| `markEmailAsRead` | Mark an email as read |
| `markEmailAsUnread` | Mark an email as unread |
| `deleteEmail` | Delete an email message |

### People

| Tool | Description |
|---|---|
| `searchPeople` | Search for colleagues and contacts |
| `getPerson` | Get details of a specific person by ID |

### Example prompts

```
What meetings do I have this week?
Schedule a 1-hour meeting with alice@example.com tomorrow at 2pm
Find a time when alice@example.com and bob@example.com are both free next week
Show my unread emails
Send an email to alice@example.com with subject "Hello" and body "How are you?"
```

> **Human approval required:** `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`, `sendEmail`, and `deleteEmail` match the dangerous tool patterns (`create`, `update`, `delete`) and will always prompt for your explicit confirmation before executing.

## Architecture

```
Agent
  └── MCPServerManager (stdio JSON-RPC 2.0)
        └── outlook MCP server (node dist/src/mcp/server/outlook/index.js)
              ├── auth.ts       — MSAL device code flow, token caching via AUTH_OUTLOOK
              ├── authConfig.ts — MSAL configuration and Graph API scopes
              ├── graphClient.ts — Microsoft Graph API wrapper (calendar, email, people, schedule)
              └── types.ts      — Zod schemas for all request/response types
```

### Token persistence

The MSAL token cache (containing the refresh token) is serialized via a custom `ICachePlugin` and stored in `AUTH_OUTLOOK`. This mirrors the `AUTH_GITHUB_COPILOT` pattern used by the GitHub Copilot LLM provider. When the access token expires, MSAL automatically uses the refresh token to acquire a new one without user interaction.

### Auth retry

Every Graph API call is wrapped in `withAuthRetry()` — on HTTP 401, the in-process access token cache is cleared and the call is retried once after re-acquiring via the cached refresh token. This handles mid-session token expiry transparently.

## Troubleshooting

**`OUTLOOK_CLIENT_ID` not set**

The server fails to start. Ensure `OUTLOOK_CLIENT_ID` is set in `.env` before enabling the server.

**Authentication cancelled or failed**

Re-run `npm run cli` and type `outlook` to start a fresh device code flow. Any stale cached accounts are cleared automatically before the new flow begins.

**HTTP 401 after token refresh**

If the refresh token has expired (typically after 90 days of inactivity), re-authenticate:

```
npm run cli
> outlook
```

**Multiple accounts found**

The server only supports a single authenticated account. Clear all accounts and re-authenticate:

```
npm run cli
> outlook
```

**Personal accounts return HTTP 401**

Ensure the Azure AD app registration uses **"Accounts in any organizational directory and personal Microsoft accounts"** (the `common` authority). A tenant-specific authority will reject personal Microsoft accounts.

**Graph API permission errors**

Ensure all required delegated permissions are added and (if required by your tenant) admin consent is granted.
