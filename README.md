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
# Authentication will be handled via OAuth - run the CLI and use 'login' command
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
# Authentication handled via OAuth - use CLI 'login' command
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
LLM_PROVIDER=ollama npm run build && node dist/cli.js
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

## Docker Usage

You can build and run the AI Agent server in a Docker container for easy deployment.

### 1. Build the Docker Image

```bash
docker build -t aiagent .
```

### 2. Run the Container

Mount your `.env` file and SSL certificates for HTTPS:

```bash
docker run -p 443:3000 \
  --env-file .env \
  -v $(pwd)/server.key:/app/server.key \
  -v $(pwd)/server.cert:/app/server.cert \
  aiagent
```

- The server will use the environment variables from `.env` and the SSL certificates you provide.
- Adjust the port mapping if you use a different port in your `.env`.

### 3. Development Tips
- For local development, you can use self-signed certificates (see instructions above).
- For production, use real certificates and secure environment variable management.

### 4. Customization
- You can override environment variables with `-e VAR=value` or by editing `.env`.
- For multi-container setups (e.g., with PostgreSQL), consider using `docker-compose`.

## Using a Private Docker Registry

You can host your own private Docker registry to store and share images securely.

### 1. Start a Local Private Registry

```bash
docker run -d -p 6000:5000 --restart=always --name registry registry:3
```
This starts a registry on `localhost:6000`.

### 2. Tag Your Image for the Registry

```bash
docker tag aiagent:latest localhost:6000/aiagent:latest
```

### 3. Push Your Image

```bash
docker push localhost:6000/aiagent:latest
```

### 4. Pull Your Image

```bash
docker pull localhost:6000/aiagent:latest
```

## Kubernetes Deployment

To deploy your application and services in Kubernetes:

### 1. Apply Deployment YAML

Run this command in your project directory:

```sh
kubectl apply -f deployment.yaml
```

### 2. Apply Service YAML (if you have one)

```sh
kubectl apply -f service.yaml
```

### 3. Check Status

```sh
kubectl get deployments
kubectl get pods
kubectl get services
```

Make sure your Kubernetes cluster is running and `kubectl` is configured.

## Stopping/Deleting Kubernetes Deployments and Services

To stop (delete) your deployment and its pods:

```sh
kubectl delete deployment aiagent
```

To stop (delete) your service:

```sh
kubectl delete service aiagent-service
```
(Replace `aiagent-service` with your actual service name.)

To delete all resources defined in a YAML file:

```sh
kubectl delete -f deployment.yaml
kubectl delete -f service.yaml
```

If you want to scale down instead of deleting, use:

```sh
kubectl scale deployment aiagent --replicas=0
```

## Accessing Kubernetes NodePort Services on macOS (Docker Desktop)

On macOS with Docker Desktop, NodePort services may not be accessible using the node’s INTERNAL-IP. Instead, use:

- For HTTPS (self-signed cert):
  ```sh
  curl --insecure https://localhost:<NodePort>/login
  ```
- For HTTP:
  ```sh
  curl http://localhost:<NodePort>/login
  ```

Replace `<NodePort>` with the port you configured (e.g., 30000).

If localhost does not work, use `kubectl port-forward` for reliable access:
```sh
kubectl port-forward deployment/aiagent 8443:3000
curl --insecure https://localhost:8443/login
```

This is a common workaround for local development on macOS/Docker Desktop.

---
