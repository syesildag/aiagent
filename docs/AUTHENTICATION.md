# Authentication & Session Management

## Overview

The AI Agent system uses session-based authentication with PostgreSQL storage for user sessions. It supports multiple authentication methods and includes automatic session timeout management.

## Authentication Methods

### 1. Basic Authentication (Username/Password)
### 2. OAuth (GitHub Copilot)
### 3. Session Token

## Session-Based Authentication

### How It Works

```
Client → Login (username/password) → Server validates → Session created → Token returned
Client → Use token in requests → Server validates session → Request processed
```

### Session Storage

Sessions are stored in PostgreSQL:

```sql
CREATE TABLE ai_agent_session (
    id VARCHAR PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Login Endpoint

### POST /login

Authenticate with username and password.

**Request:**
```bash
curl -X POST https://localhost:3000/login \
  -H "Content-Type: application/json" \
  -u "username:password"
```

**Response:**
```json
{
  "sessionId": "abc123xyz789",
  "message": "Login successful"
}
```

**Status Codes:**
- `200` - Login successful
- `401` - Invalid credentials
- `500` - Server error

### Implementation

```typescript
app.post('/login', asyncHandler(async (req, res) => {
   const authHeader = req.headers.authorization;
   
   if (!authHeader?.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Basic auth required' });
   }
   
   const credentials = Buffer.from(
      authHeader.slice(6),
      'base64'
   ).toString();
   
   const [username, password] = credentials.split(':');
   
   // Validate user
   const user = await aiagentuserRepository.getUserByUsername(username);
   const hashedPassword = hashPassword(password, config.HMAC_SECRET_KEY);
   
   if (!user || user.getPasswordHash() !== hashedPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
   }
   
   // Create session
   const sessionId = randomAlphaNumeric(64);
   const expires = new Date(Date.now() + config.SESSION_TIMEOUT_SECONDS * 1000);
   
   const session = new AiAgentSession();
   session.setId(sessionId);
   session.setUserId(user.getId()!);
   session.setExpires(expires);
   
   await repository.save(session);
   
   res.json({ sessionId, message: 'Login successful' });
}));
```

## Session Management

### Creating Sessions

```typescript
import { AiAgentSession } from './entities/ai-agent-session';
import randomAlphaNumeric from './utils/randomAlphaNumeric';
import { config } from './utils/config';

const sessionId = randomAlphaNumeric(64); // 64-char random string
const expires = new Date(Date.now() + config.SESSION_TIMEOUT_SECONDS * 1000);

const session = new AiAgentSession();
session.setId(sessionId);
session.setUserId(userId);
session.setExpires(expires);

await repository.save(session);
```

### Validating Sessions

```typescript
const sessionRepository = repository.getRepository(AiAgentSession);
const session = await sessionRepository.findById(sessionId);

if (!session) {
   throw new Error('Invalid session');
}

if (session.getExpires()! < new Date()) {
   throw new Error('Session expired');
}

// Session is valid
```

### Using Sessions in Requests

**Chat Request:**
```bash
curl -X POST https://localhost:3000/chat/general \
  -H "Content-Type: application/json" \
  -d '{
    "session": "abc123xyz789",
    "prompt": "Hello, how are you?"
  }'
```

**Request Validation:**
```typescript
const { session: sessionId, prompt } = req.body;

const sessionRepository = repository.getRepository(AiAgentSession);
const session = await sessionRepository.findById(sessionId);

if (!session || session.getExpires()! < new Date()) {
   return res.status(401).json({ error: 'Invalid or expired session' });
}

// Session valid, proceed with request
```

## Session Timeout

### Configuration

```bash
# In .env
SESSION_TIMEOUT_SECONDS=3600  # 1 hour
```

### Automatic Cleanup

Sessions are automatically cleaned up by a scheduled job:

```typescript
// src/jobs/sessionTimeout.ts
export default class SessionTimeout extends ThreadJobFactory {
   constructor() {
      super();
      this.setEnable(true);
   }

   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.minute = new Range(0, 60, 1); // Every minute
      return rule;
   }

   protected getWorker(): AbstractBaseWorker<Date, void> {
      return sessionTimeoutWorker;
   }
}
```

### Manual Cleanup

```bash
# Using script
npm run build
node dist/scripts/deleteExpiredSessions.js

# Or delete all sessions
node dist/scripts/deleteAllSessions.js
```

### Cleanup Implementation

```typescript
// src/scripts/deleteExpiredSessions.ts
export default async function deleteExpiredSessions() {
   const sessionRepository = repository.getRepository(AiAgentSession);
   
   const result = await queryDatabase(
      'DELETE FROM ai_agent_session WHERE expires < $1',
      [new Date()]
   );
   
   Logger.info(`Deleted ${result.rowCount} expired sessions`);
}
```

## User Management

### User Entity

```typescript
export class AiAgentUser extends Entity<number> {
   private username: string;
   private email: string;
   private passwordHash: string;
   private createdAt: Date;
   
   // Getters and setters...
}
```

### Creating Users

```bash
# Using script
npm run build
node dist/scripts/addUser.js
```

**Interactive prompts:**
```
Enter username: johndoe
Enter email: john@example.com
Enter password: ********
User created successfully!
```

### User Script Implementation

```typescript
// src/scripts/addUser.ts
import readline from 'readline';
import { AiAgentUser } from '../entities/ai-agent-user';
import { hashPassword } from '../utils/hashPassword';
import { config } from '../utils/config';

const rl = readline.createInterface({
   input: process.stdin,
   output: process.stdout
});

const username = await question('Enter username: ');
const email = await question('Enter email: ');
const password = await question('Enter password: ', true);

const user = new AiAgentUser();
user.setUsername(username);
user.setEmail(email);
user.setPasswordHash(hashPassword(password, config.HMAC_SECRET_KEY));
user.setCreatedAt(new Date());

await repository.save(user);
console.log('User created successfully!');
```

## Password Hashing

### Algorithm

Uses HMAC-SHA256 for password hashing:

```typescript
import crypto from 'crypto';

export function hashPassword(password: string, hmacKey: string): string {
   return crypto
      .createHmac('sha256', hmacKey)
      .update(password)
      .digest('hex');
}
```

### Configuration

```bash
# In .env - MUST be at least 32 characters
HMAC_SECRET_KEY=your_very_long_secret_key_at_least_32_characters
```

### Usage

```typescript
const hashedPassword = hashPassword('user_password', config.HMAC_SECRET_KEY);

// Store in database
user.setPasswordHash(hashedPassword);

// Verify password
const inputHash = hashPassword(inputPassword, config.HMAC_SECRET_KEY);
if (user.getPasswordHash() === inputHash) {
   // Password valid
}
```

## OAuth Authentication (GitHub)

### Flow

```
1. User initiates login
2. App requests device code
3. User visits URL and enters code
4. App polls for authorization
5. Token received and stored
6. Token used for API calls
7. Token auto-refreshed when expired
```

### Implementation

```typescript
import { authenticateWithGitHub, whoami } from './utils/githubAuth';

// Start authentication
const token = await authenticateWithGitHub();
console.log('Authenticated!');

// Check who is authenticated
const user = await whoami();
console.log(`Logged in as: ${user}`);
```

### Token Storage

Tokens are stored in environment variables:

```typescript
import { Auth } from './utils/auth';

// Store token
await Auth.set('github_copilot', {
   type: 'oauth',
   refresh: 'ghu_...',
   access: 'ghu_...',
   expires: Date.now() + 3600000
});

// Retrieve token
const auth = await Auth.get('github_copilot');
if (auth?.type === 'oauth') {
   const { refresh, access, expires } = auth;
}
```

### Token Refresh

```typescript
import { refreshCopilotToken } from './utils/githubAuth';

const auth = await Auth.get('github_copilot');

if (auth?.type === 'oauth' && auth.expires < Date.now()) {
   const newTokens = await refreshCopilotToken(auth.refresh);
   
   await Auth.set('github_copilot', {
      type: 'oauth',
      refresh: newTokens.refresh_token,
      access: newTokens.access_token,
      expires: Date.now() + 3600000
   });
}
```

## Security Best Practices

### 1. HTTPS Only

Always use HTTPS in production:

```typescript
const options: https.ServerOptions = {
   key: fs.readFileSync('server.key'),
   cert: fs.readFileSync('server.cert')
};

https.createServer(options, app).listen(port);
```

### 2. Secure Session IDs

Use cryptographically secure random strings:

```typescript
import crypto from 'crypto';

function generateSecureSessionId(): string {
   return crypto.randomBytes(32).toString('hex');
}
```

### 3. Password Requirements

Enforce strong passwords:

```typescript
function validatePassword(password: string): boolean {
   return (
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password)
   );
}
```

### 4. Rate Limiting

Protect against brute force:

```typescript
import { rateLimit } from 'express-rate-limit';

const loginLimiter = rateLimit({
   windowMs: 15 * 60 * 1000, // 15 minutes
   max: 5, // 5 attempts
   message: 'Too many login attempts, try again later'
});

app.post('/login', loginLimiter, loginHandler);
```

### 5. Session Cleanup

Regularly clean up expired sessions:

```typescript
// Run every minute
schedule.scheduleJob('* * * * *', async () => {
   await deleteExpiredSessions();
});
```

## Middleware

### Session Validation Middleware

```typescript
async function validateSession(
   req: Request,
   res: Response,
   next: NextFunction
) {
   const sessionId = req.body.session;
   
   if (!sessionId) {
      return res.status(401).json({ error: 'Session required' });
   }
   
   const sessionRepository = repository.getRepository(AiAgentSession);
   const session = await sessionRepository.findById(sessionId);
   
   if (!session || session.getExpires()! < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired session' });
   }
   
   // Attach session to request
   req.session = session;
   next();
}

// Use middleware
app.post('/chat/:agent', validateSession, chatHandler);
```

## Error Handling

### Authentication Errors

```typescript
class AuthenticationError extends Error {
   constructor(message: string) {
      super(message);
      this.name = 'AuthenticationError';
   }
}

// Usage
if (!validCredentials) {
   throw new AuthenticationError('Invalid username or password');
}
```

### Session Errors

```typescript
class SessionError extends Error {
   constructor(message: string) {
      super(message);
      this.name = 'SessionError';
   }
}

// Usage
if (!session) {
   throw new SessionError('Session not found');
}

if (session.getExpires()! < new Date()) {
   throw new SessionError('Session expired');
}
```

## Testing

### Test User Creation

```typescript
describe('User Creation', () => {
   test('should create user with hashed password', async () => {
      const user = new AiAgentUser();
      user.setUsername('testuser');
      user.setPasswordHash(hashPassword('password123', config.HMAC_SECRET_KEY));
      
      await repository.save(user);
      
      const retrieved = await repository
         .getRepository(AiAgentUser)
         .findById(user.getId()!);
      
      expect(retrieved?.getUsername()).toBe('testuser');
      expect(retrieved?.getPasswordHash()).toBe(
         hashPassword('password123', config.HMAC_SECRET_KEY)
      );
   });
});
```

### Test Session Validation

```typescript
describe('Session Validation', () => {
   test('should reject expired session', async () => {
      const session = new AiAgentSession();
      session.setId('test123');
      session.setUserId(1);
      session.setExpires(new Date(Date.now() - 1000)); // Expired
      
      await repository.save(session);
      
      const retrieved = await repository
         .getRepository(AiAgentSession)
         .findById('test123');
      
      expect(retrieved!.getExpires()! < new Date()).toBe(true);
   });
});
```

## Troubleshooting

### Session Not Found
- Check session ID is correct
- Verify session hasn't expired
- Check database connectivity

### Authentication Failed
- Verify username and password
- Check password hash algorithm
- Ensure HMAC_SECRET_KEY matches

### Token Expired
- Re-authenticate using CLI
- Check token refresh logic
- Verify system time is correct

## Related Documentation

- [Configuration](CONFIGURATION.md)
- [API Reference](API_REFERENCE.md)
- [CLI Guide](CLI_GUIDE.md)
- [Error Handling](ERROR_HANDLING.md)
