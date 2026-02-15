# Configuration Guide

## Overview

The AI Agent system uses environment variables for configuration, validated with Zod schemas. All configuration is centralized in `src/utils/config.ts`.

## Environment Files

### .env

Main configuration file (never commit to git):

```bash
cp .env.example .env
# Edit .env with your settings
```

### .env.example

Template with all available options:

```bash
# Application
NODE_ENV=development
PORT=3000
HOST=localhost
SERVER_TERMINATE_TIMEOUT=5000

# Database
DB_USER=postgres
DB_HOST=localhost
DB_NAME=aiagent
DB_PASSWORD=password
DB_PORT=5432
DB_POOL_MAX=20
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_POOL_CONNECTION_TIMEOUT_MS=2000

# Security
HMAC_SECRET_KEY=your_hmac_secret_key_at_least_32_characters_long
SESSION_TIMEOUT_SECONDS=3600

# LLM Provider
LLM_PROVIDER=ollama
LLM_MODEL=qwen3:4b
OLLAMA_HOST=http://localhost:11434
MAX_LLM_ITERATIONS=2

# OpenAI
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://api.openai.com

# GitHub Copilot
GITHUB_COPILOT_CLIENT_ID=Iv1.b507a08c87ecfe98
GITHUB_COPILOT_BASE_URL=https://api.githubcopilot.com
GITHUB_COPILOT_EMBEDDINGS_BASE_URL=https://copilot-proxy.githubusercontent.com
AUTH_GITHUB_COPILOT={"type":"oauth","refresh":"...","access":"...","expires":...}

# User Management
DEFAULT_USERNAME=admin
DEFAULT_PASSWORD=change_this_password

# MCP Servers
MCP_SERVERS_PATH=./mcp-servers.json

# Conversation History
CONVERSATION_HISTORY_WINDOW_SIZE=10
USE_DB_CONVERSATION_HISTORY=false

# Embeddings
EMBEDDING_PROVIDER=auto
EMBEDDING_MODEL_OPENAI=text-embedding-3-small
EMBEDDING_MODEL_OLLAMA=nomic-embed-text
EMBEDDING_CACHE_ENABLED=true
EMBEDDING_CACHE_TTL=3600000

# External APIs
OPENWEATHERMAP_API_KEY=your_weather_api_key
```

## Configuration Categories

### Application Settings

#### NODE_ENV

Environment mode: `development`, `production`, or `test`

```bash
NODE_ENV=development
```

**Effects:**
- Development: Verbose logging, hot reload
- Production: Optimized performance, minimal logging
- Test: Test database, mocked services

#### PORT

Server port (1-65535)

```bash
PORT=3000
```

#### HOST

Server hostname

```bash
HOST=localhost
# Or
HOST=0.0.0.0  # Listen on all interfaces
```

#### SERVER_TERMINATE_TIMEOUT

Graceful shutdown timeout (milliseconds)

```bash
SERVER_TERMINATE_TIMEOUT=5000
```

---

### Database Settings

#### DB_USER, DB_PASSWORD, DB_HOST, DB_NAME, DB_PORT

PostgreSQL connection details

```bash
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_HOST=localhost
DB_NAME=aiagent
DB_PORT=5432
```

#### DB_POOL_MAX

Maximum database connections (1-100)

```bash
DB_POOL_MAX=20
```

**Recommendations:**
- Development: 5-10
- Production: 20-50
- High load: 50-100

#### DB_POOL_IDLE_TIMEOUT_MS

Idle connection timeout (milliseconds)

```bash
DB_POOL_IDLE_TIMEOUT_MS=30000  # 30 seconds
```

#### DB_POOL_CONNECTION_TIMEOUT_MS

Connection acquisition timeout (milliseconds)

```bash
DB_POOL_CONNECTION_TIMEOUT_MS=2000  # 2 seconds
```

---

### Security Settings

#### HMAC_SECRET_KEY

Secret key for password hashing (minimum 32 characters)

```bash
HMAC_SECRET_KEY=generate_a_very_long_random_string_at_least_32_chars
```

**Generate secure key:**
```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### SESSION_TIMEOUT_SECONDS

Session expiration time (seconds)

```bash
SESSION_TIMEOUT_SECONDS=3600  # 1 hour
```

**Common values:**
- 30 minutes: 1800
- 1 hour: 3600
- 1 day: 86400
- 1 week: 604800

---

### LLM Provider Settings

#### LLM_PROVIDER

Active LLM provider

```bash
LLM_PROVIDER=ollama  # ollama|openai|github
```

#### LLM_MODEL

Model name for the selected provider

```bash
# Ollama
LLM_MODEL=qwen3:4b

# OpenAI
LLM_MODEL=gpt-4o-mini

# GitHub Copilot
LLM_MODEL=gpt-4o-mini
```

#### OLLAMA_HOST

Ollama server URL

```bash
OLLAMA_HOST=http://localhost:11434
```

#### MAX_LLM_ITERATIONS

Maximum tool-calling iterations (1-10)

```bash
MAX_LLM_ITERATIONS=2
```

Prevents infinite loops in tool execution.

---

### OpenAI Settings

#### OPENAI_API_KEY

OpenAI API key (required for OpenAI provider)

```bash
OPENAI_API_KEY=sk-proj-...your-key...
```

Get from: https://platform.openai.com/api-keys

#### OPENAI_BASE_URL

OpenAI API endpoint

```bash
OPENAI_BASE_URL=https://api.openai.com
```

Can be changed for proxies or compatible APIs.

---

### GitHub Copilot Settings

#### GITHUB_COPILOT_CLIENT_ID

OAuth application client ID

```bash
GITHUB_COPILOT_CLIENT_ID=Iv1.b507a08c87ecfe98
```

#### GITHUB_COPILOT_BASE_URL

GitHub Copilot API endpoint

```bash
GITHUB_COPILOT_BASE_URL=https://api.githubcopilot.com
```

#### GITHUB_COPILOT_EMBEDDINGS_BASE_URL

GitHub Copilot embeddings endpoint

```bash
GITHUB_COPILOT_EMBEDDINGS_BASE_URL=https://copilot-proxy.githubusercontent.com
```

#### AUTH_GITHUB_COPILOT

Stored authentication token (auto-managed)

```bash
AUTH_GITHUB_COPILOT={"type":"oauth","refresh":"ghu_...","access":"ghu_...","expires":1234567890}
```

**Note:** Managed automatically by CLI, don't edit manually.

---

### MCP Settings

#### MCP_SERVERS_PATH

Path to MCP servers configuration file

```bash
MCP_SERVERS_PATH=./mcp-servers.json
```

---

### Conversation History Settings

#### CONVERSATION_HISTORY_WINDOW_SIZE

Number of messages to keep in context (minimum 1)

```bash
CONVERSATION_HISTORY_WINDOW_SIZE=10
```

**Effects:**
- Larger: More context, higher token usage
- Smaller: Less context, lower cost

#### USE_DB_CONVERSATION_HISTORY

Store conversation history in database

```bash
USE_DB_CONVERSATION_HISTORY=false
```

**Options:**
- `true`: Persistent, slower, supports multiple sessions
- `false`: In-memory, faster, lost on restart

---

### Embedding Settings

#### EMBEDDING_PROVIDER

Embedding provider selection

```bash
EMBEDDING_PROVIDER=auto  # auto|openai|ollama|github|local
```

**auto:** Automatically selects based on availability

#### EMBEDDING_MODEL_OPENAI

OpenAI embedding model

```bash
EMBEDDING_MODEL_OPENAI=text-embedding-3-small
```

**Options:**
- `text-embedding-3-small`: 1536 dims, cost-effective
- `text-embedding-3-large`: 3072 dims, highest quality
- `text-embedding-ada-002`: 1536 dims, legacy

#### EMBEDDING_MODEL_OLLAMA

Ollama embedding model

```bash
EMBEDDING_MODEL_OLLAMA=nomic-embed-text
```

**Options:**
- `nomic-embed-text`: 768 dims, general purpose
- `all-minilm`: 384 dims, fast
- `mxbai-embed-large`: 1024 dims, high quality

#### EMBEDDING_CACHE_ENABLED

Enable/disable embedding cache

```bash
EMBEDDING_CACHE_ENABLED=true
```

#### EMBEDDING_CACHE_TTL

Cache time-to-live (milliseconds)

```bash
EMBEDDING_CACHE_TTL=3600000  # 1 hour
```

---

### External API Settings

#### OPENWEATHERMAP_API_KEY

Weather API key (optional, for weather agent)

```bash
OPENWEATHERMAP_API_KEY=your_api_key
```

Get from: https://openweathermap.org/api

---

## Using Configuration

### Import Config

```typescript
import { config } from './utils/config';

console.log(config.PORT);           // 3000
console.log(config.LLM_PROVIDER);   // 'ollama'
console.log(config.DB_HOST);        // 'localhost'
```

### Environment Checks

```typescript
import { isProduction, isDevelopment, isTest } from './utils/config';

if (isProduction()) {
   // Production-specific code
}

if (isDevelopment()) {
   // Development-specific code
   Logger.setLevel('debug');
}

if (isTest()) {
   // Test-specific code
}
```

### Runtime Configuration Update

```typescript
import { updateEnvVariables } from './utils/envManager';

// Update environment variables
updateEnvVariables({
   'LLM_PROVIDER': 'openai',
   'LLM_MODEL': 'gpt-4o-mini'
});

// Requires application restart for config.ts changes
```

---

## Validation

Configuration is validated on startup using Zod schemas:

```typescript
// Invalid configuration
PORT=invalid  // Error: Expected number

// Missing required field
DB_USER=  // Error: String must contain at least 1 character

// Out of range
DB_POOL_MAX=200  // Error: Number must be less than or equal to 100
```

### Validation Errors

```
Environment validation failed: [
  {
    "code": "invalid_type",
    "expected": "number",
    "received": "string",
    "path": ["PORT"],
    "message": "Expected number, received string"
  }
]
```

---

## Best Practices

### 1. Never Commit .env

```bash
# .gitignore
.env
.env.local
.env.*.local
```

### 2. Use Strong Secrets

```bash
# ❌ Weak
HMAC_SECRET_KEY=secret123

# ✅ Strong
HMAC_SECRET_KEY=a8f5f167f44f4964e6c998dee827110c3a4f9c9b9d8e3e3a8b6a7c5d4e3f2a1b
```

### 3. Environment-Specific Configs

```bash
# Development
NODE_ENV=development
DB_HOST=localhost
LLM_PROVIDER=ollama

# Production
NODE_ENV=production
DB_HOST=prod-db.example.com
LLM_PROVIDER=openai
```

### 4. Use .env.example

Keep `.env.example` updated with all required variables:

```bash
# Update template
cp .env .env.example
# Remove sensitive values from .env.example
git add .env.example
```

### 5. Validate Configuration Early

```typescript
// At startup
try {
   const config = validateEnvironment();
   Logger.info('Configuration validated successfully');
} catch (error) {
   Logger.error('Invalid configuration:', error);
   process.exit(1);
}
```

---

## Docker Configuration

### Using Environment Variables

```dockerfile
FROM node:18

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_HOST=postgres

COPY . /app
WORKDIR /app

RUN npm install
RUN npm run build

CMD ["npm", "start"]
```

### Using .env File

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    env_file:
      - .env
    ports:
      - "3000:3000"
```

---

## Kubernetes Configuration

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: aiagent-config
data:
  NODE_ENV: "production"
  PORT: "3000"
  DB_HOST: "postgres-service"
  LLM_PROVIDER: "openai"
```

### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: aiagent-secrets
type: Opaque
stringData:
  DB_PASSWORD: "your-db-password"
  OPENAI_API_KEY: "your-api-key"
  HMAC_SECRET_KEY: "your-hmac-key"
```

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aiagent
spec:
  template:
    spec:
      containers:
      - name: aiagent
        image: aiagent:latest
        envFrom:
        - configMapRef:
            name: aiagent-config
        - secretRef:
            name: aiagent-secrets
```

---

## Troubleshooting

### Configuration Not Loading

```bash
# Check .env file exists
ls -la .env

# Check .env syntax
cat .env | grep -v '^#' | grep -v '^$'

# Test configuration
node -e "require('dotenv').config(); console.log(process.env.PORT)"
```

### Validation Errors

```bash
# Run with validation details
npm start 2>&1 | grep -A 10 "validation failed"
```

### Missing Variables

```bash
# Check required variables
node dist/utils/config.js
```

---

## Related Documentation

- [Authentication](AUTHENTICATION.md)
- [LLM Providers](LLM_PROVIDERS.md)
- [Deployment](DEPLOYMENT.md)
- [Testing Guide](TESTING_GUIDE.md)
