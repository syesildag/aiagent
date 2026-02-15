# Error Handling Guide

## Overview

The AI Agent system uses a structured error handling approach with custom error classes, comprehensive logging, and consistent error responses.

## Error Classes

### AppError (Base Class)

Base class for all application errors located in `src/utils/errors.ts`:

```typescript
class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

#### Properties

- **message**: Error description
- **statusCode**: HTTP status code
- **isOperational**: Indicates expected errors (vs programming errors)

---

### ValidationError

Used for input validation failures:

```typescript
class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}
```

**Usage:**

```typescript
import { ValidationError } from './utils/errors';

function createUser(username: string, password: string) {
  if (!username || username.length < 3) {
    throw new ValidationError('Username must be at least 3 characters');
  }
  
  if (!password || password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }
  
  // Create user...
}
```

---

### DatabaseError

Used for database operation failures:

```typescript
class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(message, 500);
    this.name = 'DatabaseError';
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}
```

**Usage:**

```typescript
import { DatabaseError } from './utils/errors';

async function findUserById(id: number) {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  } catch (error) {
    throw new DatabaseError('Failed to fetch user', error as Error);
  }
}
```

---

### AuthenticationError

Used for authentication failures:

```typescript
class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}
```

**Usage:**

```typescript
import { AuthenticationError } from './utils/errors';

function validateSession(sessionId: string) {
  const session = sessions.get(sessionId);
  
  if (!session) {
    throw new AuthenticationError('Invalid or expired session');
  }
  
  if (session.expiresAt < Date.now()) {
    throw new AuthenticationError('Session expired');
  }
  
  return session;
}
```

---

### NotFoundError

Used when resources are not found:

```typescript
class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}
```

**Usage:**

```typescript
import { NotFoundError } from './utils/errors';

async function getAgentByName(name: string) {
  const agent = agents.get(name);
  
  if (!agent) {
    throw new NotFoundError(`Agent '${name}'`);
  }
  
  return agent;
}
```

---

### RateLimitError

Used when rate limits are exceeded:

```typescript
class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}
```

---

## Express Error Handling

### asyncHandler Wrapper

Wraps async route handlers to catch errors:

```typescript
const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

**Usage:**

```typescript
app.post('/chat/:agent', asyncHandler(async (req, res) => {
  const { agent } = req.params;
  const { message } = req.body;
  
  // If any error is thrown, it's automatically caught and passed to error middleware
  const response = await processChat(agent, message);
  
  res.json({ response });
}));
```

---

### Global Error Middleware

Central error handler in `src/index.ts`:

```typescript
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    // Expected operational errors
    Logger.warn(`${err.name}: ${err.message}`);
    return res.status(err.statusCode).json({
      error: err.name,
      message: err.message
    });
  }
  
  // Unexpected programming errors
  Logger.error('Unhandled error:', err);
  return res.status(500).json({
    error: 'InternalServerError',
    message: 'An unexpected error occurred'
  });
});
```

---

## Error Response Format

All errors return consistent JSON structure:

```typescript
interface ErrorResponse {
  error: string;      // Error class name
  message: string;    // Human-readable description
  details?: any;      // Optional additional information
}
```

### Examples

#### Validation Error

```json
{
  "error": "ValidationError",
  "message": "Username must be at least 3 characters"
}
```

#### Authentication Error

```json
{
  "error": "AuthenticationError",
  "message": "Invalid or expired session"
}
```

#### Not Found Error

```json
{
  "error": "NotFoundError",
  "message": "Agent 'weather' not found"
}
```

#### Internal Server Error

```json
{
  "error": "InternalServerError",
  "message": "An unexpected error occurred"
}
```

---

## Logging Errors

### Logger Usage

Import logger from `src/utils/logger.ts`:

```typescript
import { Logger } from './utils/logger';

// Different log levels
Logger.debug('Detailed debug information');
Logger.info('Informational message');
Logger.warn('Warning message');
Logger.error('Error message');
```

### Error Logging Best Practices

```typescript
try {
  await riskyOperation();
} catch (error) {
  // Log with context
  Logger.error('Failed to process request', {
    operation: 'riskyOperation',
    userId: req.session.userId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  
  throw new DatabaseError('Operation failed');
}
```

---

## Database Error Handling

### Transaction Error Handling

```typescript
async function transferFunds(fromId: number, toId: number, amount: number) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Deduct from sender
    const result1 = await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2 RETURNING balance',
      [amount, fromId]
    );
    
    if (result1.rows[0].balance < 0) {
      throw new ValidationError('Insufficient funds');
    }
    
    // Add to receiver
    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [amount, toId]
    );
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new DatabaseError('Transfer failed', error as Error);
  } finally {
    client.release();
  }
}
```

### Connection Error Handling

```typescript
import { pool } from './utils/pgClient';

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = i === maxRetries - 1;
      
      if (isLastAttempt) {
        throw new DatabaseError('Operation failed after retries', error as Error);
      }
      
      Logger.warn(`Retry ${i + 1}/${maxRetries} for operation`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  
  throw new DatabaseError('Unexpected retry loop exit');
}
```

---

## Async Error Patterns

### Promise Error Handling

```typescript
async function fetchUserData(userId: number) {
  try {
    const user = await findUser(userId);
    const posts = await findUserPosts(userId);
    const comments = await findUserComments(userId);
    
    return { user, posts, comments };
  } catch (error) {
    if (error instanceof NotFoundError) {
      Logger.info(`User ${userId} not found`);
      return null;
    }
    
    Logger.error('Failed to fetch user data:', error);
    throw new DatabaseError('Failed to fetch user data');
  }
}
```

### Parallel Operations

```typescript
async function fetchMultipleUsers(userIds: number[]) {
  const results = await Promise.allSettled(
    userIds.map(id => findUser(id))
  );
  
  const users = [];
  const errors = [];
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    
    if (result.status === 'fulfilled') {
      users.push(result.value);
    } else {
      errors.push({
        userId: userIds[i],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      });
    }
  }
  
  if (errors.length > 0) {
    Logger.warn('Some users failed to load:', errors);
  }
  
  return users;
}
```

---

## MCP Error Handling

### Tool Execution Errors

```typescript
async function executeTool(toolName: string, parameters: any) {
  try {
    const result = await mcpManager.executeTool(toolName, parameters);
    return result;
  } catch (error) {
    if (error instanceof ValidationError) {
      // Invalid parameters
      throw error;
    }
    
    if (error instanceof NotFoundError) {
      // Tool not found
      throw error;
    }
    
    // MCP server error
    Logger.error(`Tool execution failed: ${toolName}`, error);
    throw new AppError(`Failed to execute tool: ${toolName}`, 500);
  }
}
```

### Server Connection Errors

```typescript
async function ensureServerRunning(serverName: string) {
  try {
    await mcpManager.getAvailableTools(serverName);
  } catch (error) {
    Logger.error(`MCP server '${serverName}' not responding`, error);
    
    try {
      await mcpManager.restartServer(serverName);
      Logger.info(`Restarted MCP server '${serverName}'`);
    } catch (restartError) {
      throw new AppError(`Failed to start MCP server: ${serverName}`, 503);
    }
  }
}
```

---

## LLM Provider Error Handling

### Provider Fallback

```typescript
async function generateResponse(prompt: string): Promise<string> {
  const providers = ['github', 'openai', 'ollama'];
  
  for (const provider of providers) {
    try {
      const llm = LLMFactory.createLLM(provider);
      const response = await llm.chat(prompt);
      return response;
    } catch (error) {
      Logger.warn(`Provider ${provider} failed, trying next`, error);
      
      if (provider === providers[providers.length - 1]) {
        throw new AppError('All LLM providers failed', 503);
      }
    }
  }
  
  throw new AppError('No LLM providers available', 503);
}
```

### API Error Handling

```typescript
async function callOpenAI(messages: any[]) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new AppError(
        `OpenAI API error: ${errorData.error?.message || response.statusText}`,
        response.status
      );
    }
    
    return await response.json();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError('Failed to call OpenAI API', 503);
  }
}
```

---

## Testing Error Handling

### Unit Tests

```typescript
import { ValidationError, DatabaseError } from '../utils/errors';

describe('Error Handling', () => {
  test('ValidationError has correct status code', () => {
    const error = new ValidationError('Invalid input');
    expect(error.statusCode).toBe(400);
    expect(error.isOperational).toBe(true);
  });
  
  test('DatabaseError wraps original error', () => {
    const originalError = new Error('Connection failed');
    const error = new DatabaseError('DB operation failed', originalError);
    
    expect(error.message).toBe('DB operation failed');
    expect(error.statusCode).toBe(500);
    expect(error.stack).toContain('Connection failed');
  });
  
  test('asyncHandler catches errors', async () => {
    const mockFn = jest.fn().mockRejectedValue(new ValidationError('Test error'));
    const handler = asyncHandler(mockFn);
    
    const req = {} as Request;
    const res = {} as Response;
    const next = jest.fn();
    
    await handler(req, res, next);
    
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
```

### Integration Tests

```typescript
import request from 'supertest';
import app from '../index';

describe('Error Responses', () => {
  test('Returns 400 for validation error', async () => {
    const response = await request(app)
      .post('/chat/general')
      .send({ message: '' })  // Empty message
      .expect(400);
    
    expect(response.body).toEqual({
      error: 'ValidationError',
      message: expect.stringContaining('message')
    });
  });
  
  test('Returns 401 for authentication error', async () => {
    const response = await request(app)
      .post('/chat/general')
      .set('Authorization', 'Basic invalid')
      .send({ message: 'test' })
      .expect(401);
    
    expect(response.body).toEqual({
      error: 'AuthenticationError',
      message: expect.any(String)
    });
  });
  
  test('Returns 404 for not found error', async () => {
    const response = await request(app)
      .post('/chat/nonexistent')
      .send({ message: 'test' })
      .expect(404);
    
    expect(response.body).toEqual({
      error: 'NotFoundError',
      message: expect.stringContaining('nonexistent')
    });
  });
});
```

---

## Debugging Errors

### Enable Debug Logging

```bash
# In .env
NODE_ENV=development
LOG_LEVEL=debug
```

### Stack Traces

```typescript
// Enable detailed stack traces
Error.stackTraceLimit = 50;

// Capture async stack traces (Node.js)
process.env.NODE_OPTIONS = '--enable-source-maps';
```

### Error Context

```typescript
class ContextualError extends AppError {
  context: Record<string, any>;
  
  constructor(message: string, context: Record<string, any>) {
    super(message);
    this.context = context;
  }
  
  toJSON() {
    return {
      error: this.name,
      message: this.message,
      context: this.context,
      stack: this.stack
    };
  }
}

// Usage
throw new ContextualError('Operation failed', {
  userId: req.session.userId,
  operation: 'updateProfile',
  timestamp: new Date().toISOString()
});
```

---

## Best Practices

### 1. Use Specific Error Classes

```typescript
// ❌ Generic error
throw new Error('Something went wrong');

// ✅ Specific error class
throw new ValidationError('Username is required');
```

### 2. Always Log Errors

```typescript
// ❌ Silent failure
try {
  await operation();
} catch (error) {
  // Error is swallowed
}

// ✅ Log and handle
try {
  await operation();
} catch (error) {
  Logger.error('Operation failed', error);
  throw new DatabaseError('Operation failed');
}
```

### 3. Don't Expose Internal Details

```typescript
// ❌ Exposes internal details
catch (error) {
  res.status(500).json({ error: error.stack });
}

// ✅ Safe error message
catch (error) {
  Logger.error('Internal error:', error);
  res.status(500).json({
    error: 'InternalServerError',
    message: 'An unexpected error occurred'
  });
}
```

### 4. Use Error Boundaries

```typescript
process.on('uncaughtException', (error) => {
  Logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
```

### 5. Clean Up Resources

```typescript
async function processFile(filePath: string) {
  const file = await fs.open(filePath, 'r');
  
  try {
    const content = await file.readFile('utf-8');
    return processContent(content);
  } finally {
    await file.close();
  }
}
```

---

## Related Documentation

- [API Reference](API_REFERENCE.md)
- [Configuration](CONFIGURATION.md)
- [Testing Guide](TESTING_GUIDE.md)
- [Logging](../README.md)
