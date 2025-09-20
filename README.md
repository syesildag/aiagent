# AI Agent with Multiple LLM Provider Support

A flexible AI agent system that supports multiple LLM providers (Ollama, GitHub Copilot, OpenAI) with Model Context Protocol (MCP) server integration, using TypeScript, PostgreSQL with pgvector extension.

## Features

- **Multiple LLM Providers**: Support for Ollama (local), GitHub Copilot, and OpenAI
- **Model Context Protocol (MCP)**: Integration with MCP servers for extended capabilities
- **Interactive CLI**: Console-based interface with cancellation support
- **Tool Caching**: Optimized performance with intelligent tool caching
- **Cancellation Support**: Graceful handling of user-initiated cancellations

## LLM Provider Configuration

### Default (Ollama - Local)
```bash
npm run build
npm start
```

### GitHub Copilot
```bash
export GITHUB_TOKEN="your_github_token"
export LLM_PROVIDER="github"
npm run build && node dist/ttt.js
```

### OpenAI
```bash
export OPENAI_API_KEY="your_openai_api_key"
export LLM_PROVIDER="openai"
npm run build && node dist/ttt.js
```

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure MCP servers in `mcp-servers.json`

3. Run with your preferred LLM provider:
```bash
# Local Ollama (default)
npm run build && npm start

# With environment variable
LLM_PROVIDER=ollama npm run build && node dist/ttt.js
```

## Examples

See `examples/llm-providers.ts` for demonstration of different provider configurations:

```bash
npx ts-node examples/llm-providers.ts
```

## Interactive Commands

While running the agent, you can use these commands:
- `help` - Show available commands
- `status` - Show MCP server status and capabilities
- `refresh` - Refresh tools cache
- `cancel` - Cancel current operation
- `clear` - Clear the screen
- `exit` or `quit` - Exit the program

## Architecture

The system uses a provider pattern to abstract different LLM services:
- `LLMProvider` interface for consistent API
- `OllamaProvider` for local Ollama instances
- `GitHubCopilotProvider` for GitHub Copilot API
- `OpenAIProvider` for OpenAI API
- `MCPServerManager` for coordinating MCP servers and LLM interactions
