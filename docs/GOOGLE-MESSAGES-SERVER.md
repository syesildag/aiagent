# Google Messages MCP Server

## Overview

The Google Messages MCP server lets the AI agent send and receive SMS/RCS messages through your Android phone — completely free, using your existing phone plan. No third-party SMS gateway or API credits required.

It is powered by [OpenMessage](https://github.com/MaxGhenis/openmessage), an open-source Go binary that implements the Google Messages protocol (via [libgm](https://github.com/tulir/mautrix-gmessages)) and exposes a stdio MCP server directly compatible with this project's `MCPServerManager`.

## Prerequisites

- Ubuntu Linux (or any Linux distro with Go 1.22+)
- Android phone with [Google Messages](https://play.google.com/store/apps/details?id=com.google.android.apps.messaging) installed
- Go 1.22+ — [install guide](https://go.dev/doc/install)

## Setup

### 1. Build the OpenMessage binary

```bash
git clone https://github.com/MaxGhenis/openmessage.git
cd openmessage
go build -o openmessage .
```

### 2. Pair with your Android phone (one-time)

```bash
./openmessage pair
```

A QR code appears in your terminal. On your Android phone:

> **Google Messages → Settings → Device pairing → Pair a device** → scan the QR code

The session is saved to `~/.local/share/openmessage/session.json` and tokens auto-refresh, so you only need to pair once.

### 3. Configure `mcp-servers.json`

Update the `google-messages` entry in [mcp-servers.json](../mcp-servers.json):

1. Replace `/path/to/openmessage` with the absolute path to the binary you built (e.g. `/home/youruser/openmessage/openmessage`)
2. Set `"enabled": true`

```json
{
  "name": "google-messages",
  "command": "/home/youruser/openmessage/openmessage",
  "args": ["serve"],
  "env": {
    "OPENMESSAGES_DATA_DIR": "${OPENMESSAGES_DATA_DIR}",
    "OPENMESSAGES_PORT": "${OPENMESSAGES_PORT}"
  },
  "enabled": true
}
```

### 4. Restart the server

```bash
npm run dev   # or npm start
```

`MCPServerManager` will spawn `openmessage serve` as a child process and the 7 tools appear automatically.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENMESSAGES_DATA_DIR` | `~/.local/share/openmessage` | Directory for SQLite DB and `session.json` |
| `OPENMESSAGES_PORT` | `7007` | Port for the optional web UI at `http://localhost:7007` |
| `OPENMESSAGES_LOG_LEVEL` | `info` | Log level (`debug` / `info` / `warn` / `error` / `trace`) |

These can be set in your shell environment or `.env` file. The `${VAR}` syntax in `mcp-servers.json` passes them through to the spawned process.

## Available Tools

All tools are prefixed `google-messages_` when called by the agent.

| Tool | Description |
|---|---|
| `get_messages` | Recent messages with optional filters (phone number, date range, limit) |
| `get_conversation` | All messages in a specific conversation |
| `search_messages` | Full-text search across all stored messages |
| `send_message` | Send an SMS or RCS message to a phone number |
| `list_conversations` | List recent conversations with metadata |
| `list_contacts` | List or search saved contacts |
| `get_status` | Check connection status and paired phone info |

### Example prompts

```
What are my recent text conversations?
Search my messages for "dinner plans"
Send an SMS to +1 555 123 4567 saying "On my way"
```

> **Human approval required:** `send_message` matches the dangerous tool pattern and will always prompt for your explicit confirmation before sending.

## Architecture

```
MCPServerManager (stdio JSON-RPC)
    └── spawns: openmessage serve (stdio MCP server)
                    └── libgm (Google Messages protocol)
                            └── Google Messages on your Android phone
```

OpenMessage stores all messages in a local SQLite database. Read queries hit SQLite directly; sends go through libgm to your phone in real time.

## Troubleshooting

**Server fails to start**

Check that the binary path in `mcp-servers.json` is correct and executable:
```bash
/path/to/openmessage --version
```

**Session expired / not paired**

Re-run the pairing step:
```bash
/path/to/openmessage pair
```

**No messages appearing**

Messages are backfilled from your phone on startup. Allow a few seconds after the server starts for the initial sync.

**Web UI**

While the agent uses the stdio interface, OpenMessage also runs a web UI at `http://localhost:7007` when the server is active. You can use it to browse conversations and send messages from a browser.
