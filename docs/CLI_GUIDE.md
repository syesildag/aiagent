# CLI Guide

## Overview

The CLI provides an interactive command-line interface for testing and interacting with AI agents, configuring LLM providers, and managing authentication.

## Starting the CLI

```bash
# Build first
npm run build

# Run CLI
npm run cli
```

## Main Menu

```
=== AI Agent CLI ===
Available commands:
  login          - Configure LLM provider and authentication
  select         - Select an AI agent to chat with
  list           - List available agents
  whoami         - Show current authentication
  tools          - List MCP tools for current agent
  servers        - List available MCP servers
  history        - Show conversation history
  clear          - Clear conversation history
  stream on/off  - Enable/disable streaming responses
  exit           - Exit the CLI
  help           - Show this help message

>
```

## Commands

### login

Configure LLM provider and authentication.

```
> login

=== LLM Provider Configuration ===
Available LLM providers:
1. Ollama (local) - No authentication required
2. GitHub Copilot - Requires GitHub authentication
3. OpenAI - Requires API key

Select a provider (1-3):
```

#### Option 1: Ollama

```
> 1
Configuring Ollama provider...
✅ Ollama provider configured successfully!

Enter model name (default: qwen3:4b):
> llama3.1:8b
✅ Model set to llama3.1:8b
```

#### Option 2: GitHub Copilot

```
> 2
Configuring GitHub Copilot provider...

Starting GitHub authentication...
Please visit: https://github.com/login/device
Enter code: ABCD-1234

Waiting for authorization...
✅ Authentication successful!
✅ GitHub Copilot provider configured successfully!
```

#### Option 3: OpenAI

```
> 3
Configuring OpenAI provider...

Enter your OpenAI API key: sk-...your-key...
✅ API key saved
✅ OpenAI provider configured successfully!

Enter model name (default: gpt-4o-mini):
> gpt-4o
✅ Model set to gpt-4o
```

### select

Select an AI agent to chat with.

```
> select

Available agents:
1. general - General purpose AI assistant
2. weather - Weather information assistant

Select an agent (1-2): 1
✅ Selected agent: general
```

Or directly:
```
> select general
✅ Selected agent: general
```

### list

List all available agents.

```
> list

Available agents:
- general: General purpose AI assistant
- weather: Weather information assistant
```

### whoami

Show current authentication status.

```
> whoami

Current authentication:
Provider: GitHub Copilot
User: johndoe
Model: gpt-4o-mini
```

### tools

List MCP tools available to current agent.

```
> tools

Available tools for agent 'general':

time-server:
  - get_current_time: Returns the current time in ISO format
    Parameters: timezone (optional)

weather-server:
  - get_weather: Get current weather for a location
    Parameters: location (required), units (optional)
```

### servers

List all MCP servers and their status.

```
> servers

MCP Servers:
✅ time-server (running)
✅ weather-server (running)
❌ github-server (stopped)

Total: 2 running, 1 stopped
```

### history

Show conversation history.

```
> history

Conversation History (last 10 messages):

[User]
What time is it?

[Assistant]
The current time is 2026-02-15T10:30:00-05:00

[User]
What's the weather in New York?

[Assistant]
The weather in New York is currently 45°F and partly cloudy.
```

### clear

Clear conversation history.

```
> clear
✅ Conversation history cleared
```

### stream on/off

Toggle streaming mode for responses.

```
> stream on
✅ Streaming enabled

> stream off
✅ Streaming disabled
```

With streaming enabled, responses appear word-by-word:
```
> What's the capital of France?
The capital of France is Paris...
```

Without streaming:
```
> What's the capital of France?
[Waiting for response...]
The capital of France is Paris, which has been the country's capital since...
```

### exit

Exit the CLI.

```
> exit
Goodbye!
```

### help

Show help message with all available commands.

```
> help

[Displays main menu with all commands]
```

## Chat Mode

After selecting an agent, enter chat mode:

```
> select general
✅ Selected agent: general

general> Hello!
Hello! How can I assist you today?

general> What time is it?
[Agent uses MCP tool: get_current_time]
The current time is 2026-02-15T10:30:00-05:00

general> /exit
[Returns to main menu]
```

### Chat Commands

While in chat mode:

| Command | Description |
|---------|-------------|
| `/exit` | Exit chat mode |
| `/clear` | Clear conversation |
| `/history` | Show history |
| `/tools` | List tools |
| `/help` | Show chat commands |

## Authentication Flow

### GitHub Copilot

```
1. > login
2. Select option 2 (GitHub Copilot)
3. CLI displays device code and URL
4. Open browser to URL
5. Enter device code
6. Authorize application
7. CLI confirms authentication
8. Token saved automatically
```

### Token Management

Tokens are automatically:
- Stored in environment variables
- Refreshed when expired
- Reused across CLI sessions

Check authentication:
```
> whoami
Provider: GitHub Copilot
User: johndoe
Token expires: 2026-02-15 12:30:00
```

## Advanced Usage

### Custom Agent Selection

```
> select general
general> [Your conversation]

general> /switch weather
✅ Switched to agent: weather
weather> What's the weather in Tokyo?
```

### Tool Inspection

```
> tools

Available tools:
- get_current_time (time-server)
- get_weather (weather-server)

> info get_current_time

Tool: get_current_time
Server: time-server
Description: Returns the current time in ISO format

Parameters:
  - timezone (string, optional): IANA timezone name

Example usage:
  "What time is it in New York?"
  "Show me the current time in Tokyo"
```

### Conversation Management

```
# Save conversation
> save conversation.json
✅ Conversation saved to conversation.json

# Load conversation
> load conversation.json
✅ Conversation loaded (15 messages)

# Export conversation
> export conversation.md
✅ Conversation exported to conversation.md
```

## Configuration

### CLI Settings

Create `~/.aiagent-cli.json`:

```json
{
  "defaultAgent": "general",
  "streamingEnabled": true,
  "historySize": 20,
  "theme": "dark",
  "showTimestamps": true
}
```

### Environment Variables

```bash
# In .env
CLI_DEFAULT_AGENT=general
CLI_HISTORY_SIZE=20
CLI_STREAMING=true
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Cancel current operation |
| `Ctrl+D` | Exit CLI |
| `Up/Down` | Navigate command history |
| `Tab` | Autocomplete commands |
| `Ctrl+L` | Clear screen |

## Scripting

### Non-Interactive Mode

```bash
# Single command
echo "What time is it?" | npm run cli -- --agent general

# Multiple commands
cat commands.txt | npm run cli
```

### Command File

**commands.txt:**
```
select general
What is 2+2?
What time is it?
exit
```

Run:
```bash
npm run cli < commands.txt > output.txt
```

## Error Handling

### Connection Errors

```
> select general
❌ Error: Failed to connect to LLM provider
Suggestion: Check that Ollama is running (ollama serve)
```

### Authentication Errors

```
> whoami
❌ Error: Not authenticated
Suggestion: Run 'login' to configure authentication
```

### Agent Errors

```
general> What time is it?
❌ Error: MCP server 'time-server' not responding
Suggestion: Restart MCP servers or check configuration
```

## Debugging

### Enable Debug Mode

```bash
# In .env
NODE_ENV=development

# Or via CLI
npm run cli -- --debug
```

Debug output:
```
[DEBUG] Loading configuration from .env
[DEBUG] Connecting to database
[DEBUG] Initializing MCP servers
[DEBUG] Starting time-server (PID: 12345)
[DEBUG] Starting weather-server (PID: 12346)
[INFO] CLI ready
```

### View Logs

```bash
# View CLI logs
tail -f logs/cli.log

# View agent logs
tail -f logs/agent.log

# View MCP server logs
tail -f logs/mcp.log
```

## Testing

### Test Chat

```bash
> select general
general> Test message
[Expected response]
```

### Test Tools

```bash
general> What time is it?
[Should use get_current_time tool]

general> What's the weather in Paris?
[Should use get_weather tool]
```

### Test Streaming

```bash
> stream on
general> Tell me a story
[Words should appear progressively]
```

## Examples

### Basic Chat Session

```
$ npm run cli

> login
> Select 1 (Ollama)
> Enter model: qwen3:4b

> select general
general> Hello!
Hello! How can I help you today?

general> What's 5 + 5?
5 + 5 equals 10.

general> /exit
> exit
Goodbye!
```

### Tool Usage

```
$ npm run cli

> select general
general> What time is it in Tokyo?

[Agent queries time-server]
The current time in Tokyo (Asia/Tokyo) is 2026-02-16T01:30:00+09:00

general> What's the weather there?

[Agent queries weather-server]
The weather in Tokyo is currently 12°C, clear skies.
```

### Provider Switching

```
$ npm run cli

> login
> Select 1 (Ollama)
✅ Configured Ollama

[Chat with local model]

> login
> Select 2 (GitHub Copilot)
✅ Configured GitHub Copilot

[Chat now uses GitHub Copilot]
```

## Troubleshooting

### CLI Won't Start

```bash
# Check Node.js version
node --version  # Should be 18+

# Rebuild
npm run build

# Check for errors
npm run cli 2>&1 | tee cli-error.log
```

### Command Not Found

```
> invalid-command
❌ Unknown command: invalid-command
Type 'help' for available commands
```

### Agent Not Responding

```
general> [Message]
[Timeout after 30 seconds]
❌ Error: Request timeout

Suggestions:
- Check network connectivity
- Verify LLM provider is running
- Increase timeout in config
```

## Related Documentation

- [Authentication](AUTHENTICATION.md)
- [LLM Providers](LLM_PROVIDERS.md)
- [Agent System](AGENT_SYSTEM.md)
- [MCP Integration](MCP_INTEGRATION.md)
