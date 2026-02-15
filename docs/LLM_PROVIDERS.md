# LLM Providers Configuration

## Overview

The AI Agent system supports multiple Large Language Model (LLM) providers, allowing you to choose between local models, cloud-based services, or GitHub Copilot. Each provider has its own configuration and authentication requirements.

## Supported Providers

| Provider | Type | Authentication | Use Case |
|----------|------|----------------|----------|
| Ollama | Local | None | Development, privacy-sensitive |
| OpenAI | Cloud | API Key | Production, high quality |
| GitHub Copilot | Cloud | OAuth | GitHub integration |

## Configuration

### Environment Variables

```bash
# Provider Selection
LLM_PROVIDER=ollama|openai|github

# Model Selection
LLM_MODEL=qwen3:4b

# Provider-Specific Settings
OLLAMA_HOST=http://localhost:11434
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.openai.com
GITHUB_COPILOT_BASE_URL=https://api.githubcopilot.com
GITHUB_COPILOT_EMBEDDINGS_BASE_URL=https://copilot-proxy.githubusercontent.com
```

## Ollama (Local)

### Features
- Run models locally
- No API costs
- Privacy-focused
- Offline capable
- Customizable models

### Setup

1. Install Ollama:
```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download from https://ollama.com/download
```

2. Start Ollama service:
```bash
ollama serve
```

3. Pull a model:
```bash
ollama pull qwen3:4b
ollama pull llama3.1:8b
ollama pull mistral:7b
```

4. Configure in `.env`:
```bash
LLM_PROVIDER=ollama
LLM_MODEL=qwen3:4b
OLLAMA_HOST=http://localhost:11434
```

### Available Models

| Model | Size | Best For |
|-------|------|----------|
| qwen3:4b | 2.3GB | Fast responses, low memory |
| llama3.1:8b | 4.7GB | Balanced performance |
| mistral:7b | 4.1GB | Code and reasoning |
| codellama:13b | 7.4GB | Code generation |

### Custom Model Configuration

```typescript
import { OllamaProvider } from './mcp/llmProviders';

const ollama = new OllamaProvider(
   'http://localhost:11434',
   'custom-model:latest'
);
```

### Ollama Options

```typescript
const options = {
   seed: 123,              // Reproducible outputs
   temperature: 0.7,       // Creativity (0-1)
   top_p: 0.9,            // Nucleus sampling
   top_k: 40,             // Top-k sampling
   repeat_penalty: 1.1,    // Penalize repetition
   num_predict: 2000,      // Max tokens
   stop: ['</s>']         // Stop sequences
};
```

## OpenAI

### Features
- High-quality responses
- Fast inference
- Latest GPT models
- Large context windows
- Multi-modal support

### Setup

1. Get API key from [OpenAI Platform](https://platform.openai.com/api-keys)

2. Configure in `.env`:
```bash
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...your_key...
OPENAI_BASE_URL=https://api.openai.com
```

### Available Models

| Model | Context | Best For | Cost |
|-------|---------|----------|------|
| gpt-4o | 128K | Complex tasks | $$$ |
| gpt-4o-mini | 128K | Most tasks | $ |
| gpt-3.5-turbo | 16K | Fast & cheap | $ |

### OpenAI Options

```typescript
const options = {
   temperature: 0.7,
   top_p: 1,
   max_tokens: 2000,
   presence_penalty: 0,
   frequency_penalty: 0,
   stop: null
};
```

### Custom Configuration

```typescript
import { OpenAIProvider } from './mcp/llmProviders';

const openai = new OpenAIProvider(
   'sk-your-api-key',
   'https://api.openai.com',
   'gpt-4o-mini'
);
```

## GitHub Copilot

### Features
- GitHub integration
- OAuth authentication
- OpenAI-powered
- No separate API key needed
- Included with Copilot subscription

### Setup

1. Ensure you have GitHub Copilot subscription

2. Configure in `.env`:
```bash
LLM_PROVIDER=github
GITHUB_COPILOT_BASE_URL=https://api.githubcopilot.com
GITHUB_COPILOT_CLIENT_ID=Iv1.b507a08c87ecfe98
```

3. Authenticate via CLI:
```bash
npm run cli
> login
> Select option 2 (GitHub Copilot)
> Follow authentication flow
```

### Authentication Flow

1. CLI displays device code and URL
2. Visit URL in browser
3. Enter device code
4. Authorize application
5. Token saved automatically

### Token Management

Tokens are stored in environment variables and auto-refreshed:

```typescript
// Check current authentication
const user = await whoami();
console.log(`Authenticated as: ${user}`);

// Token refresh (automatic)
const auth = await Auth.get('github_copilot');
if (auth.type === 'oauth' && auth.expires < Date.now()) {
   await refreshCopilotToken(auth.refresh);
}
```

### GitHub Copilot Options

```typescript
const options = {
   temperature: 0.7,
   top_p: 1,
   max_tokens: 4096,
   stream: true
};
```

## Provider Factory

The system automatically creates the correct provider based on configuration:

```typescript
import { createLLMProvider, getLLMModel } from './mcp/llmFactory';

const provider = await createLLMProvider();
const model = getLLMModel();

// Provider is ready to use
const response = await provider.chat(messages, tools, options);
```

## Switching Providers

### Via Environment Variables

```bash
# Switch to OpenAI
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini

# Restart application
npm start
```

### Via CLI

```bash
npm run cli
> login
> Select desired provider
> Configure authentication
```

### Programmatically

```typescript
import { updateEnvVariables } from './utils/envManager';

updateEnvVariables({
   'LLM_PROVIDER': 'ollama',
   'LLM_MODEL': 'llama3.1:8b'
});

// Reinitialize provider
const provider = await createLLMProvider();
```

## Streaming Support

All providers support streaming responses:

```typescript
const stream = await provider.chat(
   messages,
   tools,
   { ...options, stream: true }
);

const reader = stream.getReader();
while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   
   const chunk = JSON.parse(value);
   if (chunk.choices?.[0]?.delta?.content) {
      process.stdout.write(chunk.choices[0].delta.content);
   }
}
```

## Tool Support

All providers support function calling with MCP tools:

```typescript
const tools = await mcpManager.getAllTools();

const response = await provider.chat(
   messages,
   tools,  // Tools in OpenAI format
   options
);

// Handle tool calls
if (response.message.tool_calls) {
   for (const toolCall of response.message.tool_calls) {
      const result = await mcpManager.callTool(
         toolCall.function.name,
         JSON.parse(toolCall.function.arguments)
      );
   }
}
```

## Embeddings

Different providers offer embedding models:

### OpenAI Embeddings

```typescript
const embedding = await generateEmbedding(
   'text to embed',
   'openai',
   'text-embedding-3-small'
);
```

### Ollama Embeddings

```typescript
const embedding = await generateEmbedding(
   'text to embed',
   'ollama',
   'nomic-embed-text'
);
```

### GitHub Copilot Embeddings

```typescript
const embedding = await generateEmbedding(
   'text to embed',
   'github',
   'copilot-embedding'
);
```

See [Embedding Service](EMBEDDING_SERVICE.md) for more details.

## Error Handling

### Provider Errors

```typescript
try {
   const response = await provider.chat(messages, tools, options);
} catch (error) {
   if (error.message.includes('authentication')) {
      Logger.error('Authentication failed - check API key');
   } else if (error.message.includes('rate limit')) {
      Logger.error('Rate limit exceeded - wait and retry');
   } else {
      Logger.error(`Provider error: ${error.message}`);
   }
}
```

### Provider Fallback

```typescript
async function chatWithFallback(messages, tools, options) {
   try {
      return await provider.chat(messages, tools, options);
   } catch (error) {
      Logger.warn(`Primary provider failed: ${error.message}`);
      
      // Fallback to Ollama
      const fallbackProvider = new OllamaProvider(
         config.OLLAMA_HOST,
         'qwen3:4b'
      );
      return await fallbackProvider.chat(messages, tools, options);
   }
}
```

## Performance Comparison

| Metric | Ollama | OpenAI | GitHub Copilot |
|--------|--------|--------|----------------|
| Latency | Low (local) | Medium | Medium |
| Cost | Free | $$$ | Included |
| Quality | Good | Excellent | Excellent |
| Privacy | High | Low | Low |
| Offline | Yes | No | No |

## Best Practices

### 1. Provider Selection

- **Development**: Use Ollama for cost-free development
- **Production**: Use OpenAI or GitHub Copilot for quality
- **Privacy**: Use Ollama for sensitive data
- **Integration**: Use GitHub Copilot for GitHub workflows

### 2. Model Selection

- **Speed**: Smaller models (4B parameters)
- **Quality**: Larger models (8B+ parameters)
- **Balance**: Medium models (7-8B parameters)

### 3. Cost Optimization

- Cache responses when possible
- Use smaller models for simple tasks
- Implement request deduplication
- Set appropriate max_tokens limits

### 4. Error Handling

- Implement retries with exponential backoff
- Provide fallback providers
- Log all errors for monitoring
- Handle rate limits gracefully

## Troubleshooting

### Ollama Connection Failed
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve

# Check model is available
ollama list
```

### OpenAI Authentication Failed
```bash
# Verify API key
echo $OPENAI_API_KEY

# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### GitHub Copilot Token Expired
```bash
# Re-authenticate
npm run cli
> login
> Select GitHub Copilot
> Complete authentication flow
```

## Testing

### Test Provider Connection

```typescript
import { createLLMProvider } from './mcp/llmFactory';

const provider = await createLLMProvider();
const response = await provider.chat(
   [{ role: 'user', content: 'Hello' }],
   [],
   { max_tokens: 50 }
);

console.log('Provider working:', response.message.content);
```

### Test All Providers

```bash
# Test Ollama
LLM_PROVIDER=ollama npm test

# Test OpenAI
LLM_PROVIDER=openai OPENAI_API_KEY=your_key npm test

# Test GitHub Copilot
LLM_PROVIDER=github npm test
```

## Related Documentation

- [Agent System](AGENT_SYSTEM.md)
- [MCP Integration](MCP_INTEGRATION.md)
- [Configuration](CONFIGURATION.md)
- [Embedding Service](EMBEDDING_SERVICE.md)
