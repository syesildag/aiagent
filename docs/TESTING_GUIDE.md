# Testing Guide

## Overview

The AI Agent system uses Jest for testing with TypeScript support. Tests cover unit tests, integration tests, and database operations.

## Test Configuration

### jest.config.ts

```typescript
import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/index.ts',
    '!src/examples/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json'
    }
  }
};

export default config;
```

### tsconfig.test.json

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node"]
  },
  "include": ["src/**/*.test.ts", "src/**/*.ts"]
}
```

---

## Running Tests

### All Tests

```bash
npm test
```

### Single Test File

```bash
npm test src/utils/config.test.ts
```

### Watch Mode

```bash
npm test -- --watch
```

### Coverage Report

```bash
npm test -- --coverage
```

### Specific Test Suite

```bash
npm test -- --testNamePattern="ConversationHistory"
```

### Verbose Output

```bash
npm test -- --verbose
```

---

## Test Structure

### Basic Test

```typescript
describe('Module Name', () => {
  test('should do something', () => {
    const result = functionUnderTest();
    expect(result).toBe(expectedValue);
  });
});
```

### Async Test

```typescript
describe('Async Operations', () => {
  test('should fetch data', async () => {
    const data = await fetchData();
    expect(data).toHaveProperty('id');
  });
});
```

### Setup and Teardown

```typescript
describe('Database Tests', () => {
  beforeAll(async () => {
    // Run once before all tests
    await connectDatabase();
  });
  
  afterAll(async () => {
    // Run once after all tests
    await disconnectDatabase();
  });
  
  beforeEach(async () => {
    // Run before each test
    await clearDatabase();
  });
  
  afterEach(async () => {
    // Run after each test
    await cleanup();
  });
  
  test('should create user', async () => {
    const user = await createUser('test');
    expect(user.username).toBe('test');
  });
});
```

---

## Unit Testing

### Testing Utilities

#### config.test.ts

```typescript
import { config } from './config';

describe('Config', () => {
  test('should load environment variables', () => {
    expect(config.PORT).toBeDefined();
    expect(typeof config.PORT).toBe('number');
  });
  
  test('should validate database config', () => {
    expect(config.DB_HOST).toBeDefined();
    expect(config.DB_PORT).toBeGreaterThan(0);
    expect(config.DB_PORT).toBeLessThanOrEqual(65535);
  });
  
  test('should provide LLM configuration', () => {
    expect(['ollama', 'openai', 'github']).toContain(config.LLM_PROVIDER);
    expect(config.LLM_MODEL).toBeTruthy();
  });
});
```

#### conversationHistory.test.ts

```typescript
import { InMemoryConversationHistory } from './conversationHistory';

describe('InMemoryConversationHistory', () => {
  let history: InMemoryConversationHistory;
  
  beforeEach(() => {
    history = new InMemoryConversationHistory({ windowSize: 3 });
  });
  
  test('should add messages', async () => {
    await history.addMessage({ role: 'user', content: 'Hello' });
    const messages = await history.getMessages();
    
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello');
  });
  
  test('should enforce window size', async () => {
    await history.addMessage({ role: 'user', content: 'Message 1' });
    await history.addMessage({ role: 'assistant', content: 'Response 1' });
    await history.addMessage({ role: 'user', content: 'Message 2' });
    await history.addMessage({ role: 'assistant', content: 'Response 2' });
    
    const messages = await history.getMessages();
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('Response 1');
  });
  
  test('should clear messages', async () => {
    await history.addMessage({ role: 'user', content: 'Hello' });
    await history.clear();
    
    const messages = await history.getMessages();
    expect(messages).toHaveLength(0);
  });
});
```

### Testing Entities

```typescript
import { User } from '../entities/ai-agent-user';

describe('User Entity', () => {
  test('should create user instance', () => {
    const user = new User();
    user.username = 'testuser';
    user.password_hash = 'hashed_password';
    
    expect(user.username).toBe('testuser');
    expect(user.password_hash).toBe('hashed_password');
  });
  
  test('should have default timestamps', () => {
    const user = new User();
    expect(user.created_at).toBeUndefined(); // Set by database
    expect(user.updated_at).toBeUndefined();
  });
});
```

---

## Integration Testing

### Database Integration Tests

#### dbConversationHistory.test.ts

```typescript
import { DbConversationHistory } from './dbConversationHistory';
import { pool } from './pgClient';

describe('DbConversationHistory', () => {
  let history: DbConversationHistory;
  const conversationId = 'test-conversation-123';
  
  beforeAll(async () => {
    // Setup test database
    await pool.query('BEGIN');
  });
  
  afterAll(async () => {
    // Rollback test changes
    await pool.query('ROLLBACK');
    await pool.end();
  });
  
  beforeEach(async () => {
    history = new DbConversationHistory(conversationId);
    await history.clear();
  });
  
  test('should persist messages to database', async () => {
    await history.addMessage({ role: 'user', content: 'Test message' });
    
    const result = await pool.query(
      'SELECT * FROM conversations WHERE id = $1',
      [conversationId]
    );
    
    expect(result.rows).toHaveLength(1);
  });
  
  test('should retrieve messages from database', async () => {
    await history.addMessage({ role: 'user', content: 'Message 1' });
    await history.addMessage({ role: 'assistant', content: 'Response 1' });
    
    // Create new instance to test persistence
    const newHistory = new DbConversationHistory(conversationId);
    const messages = await newHistory.getMessages();
    
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Message 1');
    expect(messages[1].content).toBe('Response 1');
  });
  
  test('should handle concurrent writes', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      history.addMessage({ role: 'user', content: `Message ${i}` })
    );
    
    await Promise.all(promises);
    
    const messages = await history.getMessages();
    expect(messages).toHaveLength(10);
  });
});
```

### API Integration Tests

```typescript
import request from 'supertest';
import app from '../index';

describe('API Endpoints', () => {
  let sessionId: string;
  
  beforeAll(async () => {
    // Login and get session
    const response = await request(app)
      .post('/login')
      .send({ username: 'admin', password: 'password' });
    
    sessionId = response.body.session_id;
  });
  
  test('POST /chat/:agent should return response', async () => {
    const response = await request(app)
      .post('/chat/general')
      .set('Authorization', `Basic ${Buffer.from(`admin:${sessionId}`).toString('base64')}`)
      .send({ message: 'Hello' })
      .expect(200);
    
    expect(response.body).toHaveProperty('response');
    expect(typeof response.body.response).toBe('string');
  });
  
  test('POST /validate/:agent should validate agent', async () => {
    const response = await request(app)
      .post('/validate/general')
      .send({ agentName: 'general' })
      .expect(200);
    
    expect(response.body).toEqual({ valid: true });
  });
  
  test('should reject unauthenticated requests', async () => {
    await request(app)
      .post('/chat/general')
      .send({ message: 'Hello' })
      .expect(401);
  });
});
```

---

## Mocking

### Mock Dependencies

```typescript
jest.mock('./utils/config', () => ({
  config: {
    PORT: 3000,
    DB_HOST: 'localhost',
    LLM_PROVIDER: 'ollama',
    LLM_MODEL: 'test-model'
  }
}));

jest.mock('./utils/pgClient', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
  }
}));
```

### Mock Functions

```typescript
import { pool } from './utils/pgClient';

describe('User Repository', () => {
  test('should fetch user by id', async () => {
    const mockQuery = pool.query as jest.Mock;
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, username: 'testuser' }]
    });
    
    const user = await findUserById(1);
    
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = $1',
      [1]
    );
    expect(user.username).toBe('testuser');
  });
});
```

### Mock Classes

```typescript
class MockLLMProvider {
  async chat(messages: any[]) {
    return 'Mock response';
  }
  
  async* chatStream(messages: any[]) {
    yield 'Mock ';
    yield 'stream ';
    yield 'response';
  }
}

jest.mock('./mcp/llmFactory', () => ({
  LLMFactory: {
    createLLM: jest.fn(() => new MockLLMProvider())
  }
}));
```

### Mock External APIs

```typescript
import fetchMock from 'jest-fetch-mock';

fetchMock.enableMocks();

describe('OpenAI Integration', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });
  
  test('should call OpenAI API', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({
      choices: [{ message: { content: 'AI response' } }]
    }));
    
    const response = await callOpenAI('Hello');
    
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        })
      })
    );
    
    expect(response).toBe('AI response');
  });
});
```

---

## Testing Async Code

### Promises

```typescript
test('should resolve promise', async () => {
  const result = await asyncOperation();
  expect(result).toBe('success');
});

test('should reject promise', async () => {
  await expect(failingOperation()).rejects.toThrow('Error message');
});
```

### Callbacks

```typescript
test('should handle callbacks', (done) => {
  callbackFunction((error, result) => {
    expect(error).toBeNull();
    expect(result).toBe('success');
    done();
  });
});
```

### Timeouts

```typescript
test('should timeout after 5 seconds', async () => {
  jest.setTimeout(10000);
  
  const result = await longRunningOperation();
  expect(result).toBeDefined();
}, 10000);
```

---

## Snapshot Testing

### Component Snapshots

```typescript
import { generateSystemPrompt } from '../agents/generalAgent';

describe('Snapshot Tests', () => {
  test('system prompt matches snapshot', () => {
    const prompt = generateSystemPrompt();
    expect(prompt).toMatchSnapshot();
  });
  
  test('config object matches snapshot', () => {
    expect(config).toMatchSnapshot({
      HMAC_SECRET_KEY: expect.any(String), // Ignore sensitive data
      created_at: expect.any(Date)
    });
  });
});
```

### Update Snapshots

```bash
npm test -- --updateSnapshot
```

---

## Coverage

### Generate Coverage Report

```bash
npm test -- --coverage
```

### Coverage Thresholds

Add to `jest.config.ts`:

```typescript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 80,
    lines: 80,
    statements: 80
  }
}
```

### View Coverage Report

```bash
open coverage/lcov-report/index.html
```

---

## Best Practices

### 1. Test Naming

```typescript
// ❌ Unclear test name
test('test1', () => { ... });

// ✅ Descriptive test name
test('should return user when valid ID is provided', () => { ... });
```

### 2. Arrange-Act-Assert Pattern

```typescript
test('should calculate total price', () => {
  // Arrange
  const items = [
    { price: 10, quantity: 2 },
    { price: 5, quantity: 3 }
  ];
  
  // Act
  const total = calculateTotal(items);
  
  // Assert
  expect(total).toBe(35);
});
```

### 3. Test One Thing

```typescript
// ❌ Multiple assertions for different things
test('user operations', () => {
  const user = createUser();
  expect(user.id).toBeDefined();
  expect(updateUser(user)).toBeTruthy();
  expect(deleteUser(user)).toBeTruthy();
});

// ✅ Separate tests
test('should create user with ID', () => {
  const user = createUser();
  expect(user.id).toBeDefined();
});

test('should update user', () => {
  const user = createUser();
  expect(updateUser(user)).toBeTruthy();
});
```

### 4. Use beforeEach for Setup

```typescript
describe('Shopping Cart', () => {
  let cart: ShoppingCart;
  
  beforeEach(() => {
    cart = new ShoppingCart();
  });
  
  test('should add item', () => {
    cart.addItem({ id: 1, name: 'Product' });
    expect(cart.items).toHaveLength(1);
  });
  
  test('should remove item', () => {
    cart.addItem({ id: 1, name: 'Product' });
    cart.removeItem(1);
    expect(cart.items).toHaveLength(0);
  });
});
```

### 5. Test Error Cases

```typescript
describe('User Validation', () => {
  test('should throw error for invalid username', () => {
    expect(() => {
      validateUsername('ab');
    }).toThrow('Username must be at least 3 characters');
  });
  
  test('should throw error for missing password', () => {
    expect(() => {
      validatePassword('');
    }).toThrow('Password is required');
  });
});
```

---

## Debugging Tests

### Run Single Test

```bash
npm test -- --testNamePattern="should add message"
```

### Enable Verbose Logging

```typescript
test('should process data', () => {
  console.log('Input:', input);
  const result = processData(input);
  console.log('Result:', result);
  expect(result).toBeDefined();
});
```

### Use debugger

```typescript
test('should debug this', () => {
  debugger; // Node debugger stops here
  const result = functionUnderTest();
  expect(result).toBe(expected);
});
```

```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

---

## Continuous Integration

### GitHub Actions

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test -- --coverage
      env:
        DB_HOST: localhost
        DB_USER: postgres
        DB_PASSWORD: postgres
        DB_NAME: test_db
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        files: ./coverage/lcov.info
```

---

## Related Documentation

- [Error Handling](ERROR_HANDLING.md)
- [Configuration](CONFIGURATION.md)
- [Database Conversation History](DbConversationHistory.md)
- [Repository Pattern](ENHANCED_REPOSITORY_PATTERN.md)
