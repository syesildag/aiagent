# AI Agent with Express.js Server and Multiple LLM Provider Support

A production-ready Express.js server with AI chat capabilities that supports multiple LLM providers (Ollama, GitHub Copilot, OpenAI) and Model Context Protocol (MCP) server integration, using TypeScript, PostgreSQL with pgvector extension.

## Features

- **Express.js HTTPS Server**: Production-ready web server with SSL support
- **Multiple LLM Providers**: Support for Ollama (local), GitHub Copilot, and OpenAI
- **Model Context Protocol (MCP)**: Integration with MCP servers for extended capabilities
- **Session-based Authentication**: Secure user sessions with PostgreSQL storage
- **Agent System**: Modular AI agents with custom tools and validation
- **Tool Caching**: Optimized performance with intelligent tool caching
- **Security Features**: Rate limiting, CORS, helmet security headers
- **Interactive CLI**: Console-based interface for testing (cli.ts)

## Quick Start

### 1. Environment Setup
Copy the environment template and configure your settings:
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 2. Database Setup
Ensure PostgreSQL is running with pgvector extension and configure database credentials in `.env`.

### 3. Start the Server

#### Default (Ollama - Local)
```bash
npm run build
npm start
```

#### GitHub Copilot
```bash
# Set in .env file:
LLM_PROVIDER=github
GITHUB_TOKEN=your_github_token
npm run build && npm start
```

#### OpenAI
```bash
# Set in .env file:
LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
npm run build && npm start
```

### 4. Local SSL Certificate Generation

For local HTTPS development, you need to generate a self-signed certificate.

1.  **Install OpenSSL**:
    Ensure OpenSSL is installed on your system. You can check with `openssl version`.

2.  **Generate Certificate**:
    Run the following command in the project root to create `server.key` and `server.cert`:

    ```bash
    openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.cert -days 365 -nodes -subj "/C=US/ST=California/L=San Francisco/O=Local Dev/CN=localhost"
    ```

    The server will automatically use these files for HTTPS.

## API Endpoints

### Authentication
- **POST /login**: Authenticate with username/password (Basic Auth)
  - Returns session token for subsequent requests

### Chat
- **POST /chat/:agent**: Send message to specific AI agent
  - Requires session token in request body
  - Returns AI response and validation flag if needed

### Validation  
- **POST /validate/:agent**: Validate data using agent-specific validation
  - Requires session token and data in request body

## Configuration

### LLM Providers
Configure in `.env`:
```bash
LLM_PROVIDER=ollama|openai|github
LLM_MODEL=qwen3:4b

# Ollama
OLLAMA_HOST=http://localhost:11434

# OpenAI  
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://api.openai.com

# GitHub Copilot
GITHUB_TOKEN=your_token  
GITHUB_COPILOT_BASE_URL=https://api.githubcopilot.com
```
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
- `login` - Configure LLM provider and authenticate (GitHub Copilot, OpenAI, or Ollama)
- `status` - Show MCP server status and capabilities
- `refresh` - Refresh tools cache
- `cancel` - Cancel current operation
- `clear` - Clear the screen
- `exit` or `quit` - Exit the program

### Login Command

The `login` command provides an interactive way to configure LLM providers:

1. **Ollama (Local)**: No authentication required
2. **GitHub Copilot**: Uses GitHub OAuth device flow for authentication
3. **OpenAI**: Prompts for API key input

For GitHub Copilot authentication:
- The CLI will display a verification URL and user code
- Visit the URL in your browser and enter the code
- The system will automatically detect completion and save the token
- Environment variables are updated automatically

**GitHub OAuth App Setup**:
1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Create a new OAuth App with any homepage URL (device flow doesn't need callback URL)

## Architecture

The system uses a provider pattern to abstract different LLM services:
- `LLMProvider` interface for consistent API
- `OllamaProvider` for local Ollama instances
- `GitHubCopilotProvider` for GitHub Copilot API
- `OpenAIProvider` for OpenAI API
- `MCPServerManager` for coordinating MCP servers and LLM interactions
