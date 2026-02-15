# API Reference

## Overview

The AI Agent API provides HTTPS endpoints for authentication, chat interactions, and data validation. All endpoints require proper authentication and return JSON responses.

## Base URL

```
https://localhost:3000
```

## Authentication

Most endpoints require a session token obtained from the login endpoint.

### Headers

```http
Content-Type: application/json
```

### Session Token

Include session token in request body:
```json
{
  "session": "your_session_token_here"
}
```

---

## Endpoints

### POST /login

Authenticate user and create session.

**Authentication:** Basic Auth (username:password)

**Headers:**
```http
Authorization: Basic base64(username:password)
Content-Type: application/json
```

**Request:**
```bash
curl -X POST https://localhost:3000/login \
  -u "username:password"
```

**Response (200 OK):**
```json
{
  "sessionId": "abc123xyz789...",
  "message": "Login successful"
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Invalid credentials"
}
```

**Example:**
```javascript
const username = 'johndoe';
const password = 'SecurePass123';
const credentials = btoa(`${username}:${password}`);

const response = await fetch('https://localhost:3000/login', {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
console.log(data.sessionId);
```

---

### POST /chat/:agent

Send message to AI agent and receive response.

**Authentication:** Session token required

**Parameters:**
- `agent` (path) - Agent name: `general`, `weather`, etc.

**Request Body:**
```json
{
  "session": "session_token",
  "prompt": "User message/query"
}
```

**Request:**
```bash
curl -X POST https://localhost:3000/chat/general \
  -H "Content-Type: application/json" \
  -d '{
    "session": "abc123xyz789",
    "prompt": "What is the current time?"
  }'
```

**Response (200 OK):**
```json
{
  "response": "The current time is 2026-02-15T10:30:00-05:00",
  "shouldValidate": false
}
```

**Response with Validation:**
```json
{
  "response": "Please provide the data to validate",
  "shouldValidate": true
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Invalid or expired session"
}
```

**Response (404 Not Found):**
```json
{
  "error": "Invalid agent selected: unknown. Available agents: general, weather"
}
```

**Streaming Response:**

When streaming is enabled, responses are sent as Server-Sent Events:

```javascript
const response = await fetch('https://localhost:3000/chat/general', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session: 'abc123',
    prompt: 'Tell me a story'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  console.log(chunk); // Partial response
}
```

---

### POST /validate/:agent

Validate data using agent-specific validation logic.

**Authentication:** Session token required

**Parameters:**
- `agent` (path) - Agent name

**Request Body:**
```json
{
  "session": "session_token",
  "data": {
    // Data to validate (structure depends on agent)
  }
}
```

**Request:**
```bash
curl -X POST https://localhost:3000/validate/general \
  -H "Content-Type: application/json" \
  -d '{
    "session": "abc123xyz789",
    "data": {
      "name": "John Doe",
      "age": 30,
      "email": "john@example.com"
    }
  }'
```

**Response (200 OK - Valid):**
```json
{
  "valid": true,
  "message": "Data validation successful"
}
```

**Response (200 OK - Invalid):**
```json
{
  "valid": false,
  "message": "Data validation failed"
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Invalid or expired session"
}
```

---

## Request/Response Schemas

### Login Request

```typescript
{
  // No body, uses Basic Auth header
}
```

### Login Response

```typescript
{
  sessionId: string;    // 64-character session token
  message: string;      // Success message
}
```

### Chat Request

```typescript
{
  session: string;      // Session token from login
  prompt: string;       // User message/query
}
```

### Chat Response

```typescript
{
  response: string;     // AI agent response
  shouldValidate: boolean;  // Whether validation is needed
}
```

### Validate Request

```typescript
{
  session: string;      // Session token
  data: any;           // Data to validate (agent-specific)
}
```

### Validate Response

```typescript
{
  valid: boolean;       // Validation result
  message: string;      // Result message
}
```

### Error Response

```typescript
{
  error: string;        // Error message
  details?: any;        // Additional error details
}
```

---

## Status Codes

| Code | Description | Meaning |
|------|-------------|---------|
| 200 | OK | Request successful |
| 400 | Bad Request | Invalid request format |
| 401 | Unauthorized | Authentication failed |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

---

## Rate Limiting

The API implements rate limiting to prevent abuse.

### Limits

- **Login endpoint**: 5 requests per 15 minutes per IP
- **Chat endpoints**: Configurable (default: 100 per 15 minutes per IP)

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1645282800
```

### Rate Limit Exceeded Response

```json
{
  "error": "Too many requests, please try again later"
}
```

---

## Error Handling

### Authentication Errors

```json
{
  "error": "Invalid credentials"
}
```
```json
{
  "error": "Invalid or expired session"
}
```

### Validation Errors

```json
{
  "error": "Invalid request format",
  "details": {
    "field": "prompt",
    "message": "prompt is required"
  }
}
```

### Server Errors

```json
{
  "error": "Internal server error",
  "details": "An unexpected error occurred"
}
```

---

## Complete Examples

### JavaScript/TypeScript

```typescript
class AIAgentClient {
  private baseUrl = 'https://localhost:3000';
  private sessionId?: string;

  async login(username: string, password: string): Promise<void> {
    const credentials = btoa(`${username}:${password}`);
    
    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Login failed');
    }
    
    const data = await response.json();
    this.sessionId = data.sessionId;
  }

  async chat(agent: string, prompt: string): Promise<string> {
    if (!this.sessionId) {
      throw new Error('Not authenticated');
    }
    
    const response = await fetch(`${this.baseUrl}/chat/${agent}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: this.sessionId,
        prompt
      })
    });
    
    if (!response.ok) {
      throw new Error('Chat request failed');
    }
    
    const data = await response.json();
    return data.response;
  }

  async validate(agent: string, data: any): Promise<boolean> {
    if (!this.sessionId) {
      throw new Error('Not authenticated');
    }
    
    const response = await fetch(`${this.baseUrl}/validate/${agent}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: this.sessionId,
        data
      })
    });
    
    if (!response.ok) {
      throw new Error('Validation request failed');
    }
    
    const result = await response.json();
    return result.valid;
  }
}

// Usage
const client = new AIAgentClient();
await client.login('username', 'password');

const response = await client.chat('general', 'Hello!');
console.log(response);

const isValid = await client.validate('general', { name: 'John' });
console.log('Valid:', isValid);
```

### Python

```python
import requests
import base64

class AIAgentClient:
    def __init__(self, base_url='https://localhost:3000'):
        self.base_url = base_url
        self.session_id = None
    
    def login(self, username, password):
        credentials = base64.b64encode(
            f'{username}:{password}'.encode()
        ).decode()
        
        response = requests.post(
            f'{self.base_url}/login',
            headers={
                'Authorization': f'Basic {credentials}',
                'Content-Type': 'application/json'
            },
            verify=False  # For self-signed cert
        )
        
        response.raise_for_status()
        data = response.json()
        self.session_id = data['sessionId']
    
    def chat(self, agent, prompt):
        if not self.session_id:
            raise Exception('Not authenticated')
        
        response = requests.post(
            f'{self.base_url}/chat/{agent}',
            json={
                'session': self.session_id,
                'prompt': prompt
            },
            verify=False
        )
        
        response.raise_for_status()
        return response.json()['response']

# Usage
client = AIAgentClient()
client.login('username', 'password')

response = client.chat('general', 'Hello!')
print(response)
```

### curl

```bash
#!/bin/bash

# Login
SESSION=$(curl -s -X POST https://localhost:3000/login \
  -u "username:password" \
  | jq -r '.sessionId')

echo "Session: $SESSION"

# Chat
RESPONSE=$(curl -s -X POST https://localhost:3000/chat/general \
  -H "Content-Type: application/json" \
  -d "{
    \"session\": \"$SESSION\",
    \"prompt\": \"What time is it?\"
  }" \
  | jq -r '.response')

echo "Response: $RESPONSE"
```

---

## WebSocket Support

Currently not supported. Use HTTP streaming for real-time responses.

---

## Versioning

The API is currently unversioned. Breaking changes will be announced in release notes.

Future versions may include:
```
/v1/chat/:agent
/v2/chat/:agent
```

---

## Security

### HTTPS Only

All endpoints require HTTPS. HTTP requests are rejected.

### Session Security

- Sessions expire after configured timeout (default: 1 hour)
- Session IDs are cryptographically random (64 characters)
- Sessions are stored server-side (not in JWT)

### Input Validation

All inputs are validated with Zod schemas before processing.

### Rate Limiting

Prevents abuse and brute force attacks.

---

## Testing

### Health Check

```bash
curl -k https://localhost:3000/
```

Expected: Server responds (may return 404, but connection works)

### Test Authentication

```bash
curl -X POST https://localhost:3000/login \
  -u "testuser:testpass" \
  -v
```

---

## Related Documentation

- [Authentication](AUTHENTICATION.md)
- [Agent System](AGENT_SYSTEM.md)
- [Configuration](CONFIGURATION.md)
- [Error Handling](ERROR_HANDLING.md)
