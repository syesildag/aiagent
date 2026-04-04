import { z } from 'zod';
import * as dotenv from 'dotenv';
import Logger from './logger';

dotenv.config();

const envSchema = z.object({
  // --- Application ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  HOST: z.string().min(1),
  // Milliseconds to wait for in-flight requests to finish on SIGTERM/SIGINT before force-closing
  SERVER_TERMINATE_TIMEOUT: z.string().transform(Number).pipe(z.number().positive()),

  // --- Database ---
  DB_USER: z.string().min(1),
  DB_HOST: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_PASSWORD: z.string().optional(),
  DB_PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  DB_POOL_MAX: z.string().transform(Number).pipe(z.number().min(1).max(100)).default('20'),
  DB_POOL_IDLE_TIMEOUT_MS: z.string().transform(Number).pipe(z.number().min(1000)).default('30000'),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.string().transform(Number).pipe(z.number().min(500)).default('10000'),

  // --- Security ---
  // Must be at least 32 characters; used for HMAC session signing
  HMAC_SECRET_KEY: z.string().min(32),
  SESSION_TIMEOUT_SECONDS: z.string().transform(Number).pipe(z.number().positive()).default('3600'),
  // bcrypt cost factor for password hashing (10–20; higher = slower but more secure)
  BCRYPT_ROUNDS: z.string().transform(Number).pipe(z.number().min(10).max(20)).default('12'),
  // Milliseconds before a pending tool-approval request auto-denies (default 5 min)
  APPROVAL_TIMEOUT_MS: z.string().transform(Number).pipe(z.number().positive()).default('300000'),
  // Comma-separated list of allowed CORS origins. Empty = same-origin only.
  ALLOWED_ORIGINS: z.string().default(''),

  // --- LLM ---
  LLM_PROVIDER: z.enum(['ollama', 'openai', 'github', 'anthropic']).default('ollama'),
  LLM_MODEL: z.string().min(1).default('qwen3:4b'),
  // Maximum number of tool-call iterations the agent may perform per chat turn
  MAX_LLM_ITERATIONS: z.string().transform(Number).pipe(z.number().min(1).max(10)).default('2'),

  // --- Ollama ---
  OLLAMA_HOST: z.string().url().default('http://localhost:11434'),

  // --- OpenAI ---
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),

  // --- Anthropic ---
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),

  // --- GitHub Copilot ---
  GITHUB_COPILOT_CLIENT_ID: z.string().min(1).default('Iv1.b507a08c87ecfe98'),
  GITHUB_COPILOT_BASE_URL: z.string().url().default('https://api.githubcopilot.com'),
  GITHUB_COPILOT_EMBEDDINGS_BASE_URL: z.string().url().default('https://api.githubcopilot.com'),
  // Serialized OAuth token object populated automatically after device-flow login
  AUTH_GITHUB_COPILOT: z.string().optional(),

  // --- Default user (auto-created on first startup if both are set) ---
  DEFAULT_USERNAME: z.string().min(1).optional(),
  DEFAULT_PASSWORD: z.string().min(8).optional(),

  // --- External APIs ---
  OPENWEATHERMAP_API_KEY: z.string().min(1).optional(),
  TAVILY_API_KEY: z.string().min(1).optional(),

  // --- Outlook / Microsoft Graph ---
  OUTLOOK_CLIENT_ID: z.string().min(1).optional(),
  // Serialized MSAL token cache + access token, populated automatically after device-flow login
  AUTH_OUTLOOK: z.string().optional(),

  // --- Debug ---
  DEBUG: z.string().optional(),

  // --- MCP ---
  MCP_SERVERS_PATH: z.string().min(1).default('./mcp-servers.json'),

  // --- XMLTV ---
  // Directory where the downloaded XMLTV files are stored (mirrors the shell script default)
  XMLTV_PATH: z.string().default('logs'),

  // --- Conversation history ---
  // When unset, all messages in the current conversation are forwarded to the LLM
  // and the built-in handleTokenLimits() mechanism trims based on the model's context window.
  CONVERSATION_HISTORY_WINDOW_SIZE: z.string().transform(Number).pipe(z.number().min(1)).optional(),
  // Token-based history window: keep only the most recent messages whose combined
  // token estimate fits within this budget. Takes precedence over CONVERSATION_HISTORY_WINDOW_SIZE.
  // Default of 8 000 leaves ~24 k tokens free for the system prompt, tools, and current turn
  // on the smallest supported model (qwen3:4b, 32 768-token context).
  CONVERSATION_HISTORY_TOKEN_BUDGET: z.string().transform(Number).pipe(z.number().min(500)).default('8000'),
  // Maximum number of past conversations retained in memory/DB. Defaults to 100.
  MAX_CONVERSATIONS: z.string().transform(Number).pipe(z.number().min(1)).default('100'),
  // Set to 'true' to persist conversation history in PostgreSQL instead of in-memory
  USE_DB_CONVERSATION_HISTORY: z.string().transform((val) => val === 'true').default('false'),

  // --- Embeddings ---
  // 'auto' selects the provider that matches LLM_PROVIDER; falls back to local transformers.js
  EMBEDDING_PROVIDER: z.enum(['openai', 'ollama', 'local', 'github', 'auto']).default('auto'),
  EMBEDDING_MODEL_OPENAI: z.string().default('text-embedding-nomic-embed-text-v1.5'),
  EMBEDDING_MODEL_OLLAMA: z.string().default('nomic-embed-text'),
  EMBEDDING_MODEL_LOCAL: z.string().default('Snowflake/snowflake-arctic-embed-s'),
  EMBEDDING_SIMILARITY_THRESHOLD: z.string().transform(Number).pipe(z.number().min(0).max(1)).default('0.5'),
  EMBEDDING_MIN_PROMPT_WORDS: z.string().transform(Number).pipe(z.number().int().min(0)).default('10'),
  EMBEDDING_CACHE_ENABLED: z.string().transform((val) => val === 'true').default('true'),
  EMBEDDING_CACHE_TTL: z.string().transform(Number).pipe(z.number().positive()).default('3600000'), // 1 hour

  // --- Logging (production + MCP servers) ---
  // Winston log level: error < warn < info < debug < silly (silly maps to trace)
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'silly']).default('info'),
  // Path to the rotating log file written by WinstonLogger in production/MCP contexts
  LOG_FILE: z.string().default('logs/app.log'),
});
type Environment = z.infer<typeof envSchema>;

function validateEnvironment(): Environment {
  // Skip validation during tests unless explicitly enabled
  if (process.env.NODE_ENV === 'test' && !process.env.VALIDATE_ENV_IN_TESTS) {
    return {
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: 'localhost',
      SERVER_TERMINATE_TIMEOUT: 5000,
      DB_USER: 'test',
      DB_HOST: 'localhost',
      DB_NAME: 'test',
      DB_PASSWORD: 'test',
      DB_PORT: 5432,
      DB_POOL_MAX: 20,
      DB_POOL_IDLE_TIMEOUT_MS: 30000,
      DB_POOL_CONNECTION_TIMEOUT_MS: 10000,
      HMAC_SECRET_KEY: 'test_hmac_key_at_least_32_characters_long_for_security',
      SESSION_TIMEOUT_SECONDS: 86400,
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'test',
      OLLAMA_HOST: 'http://localhost:11434',
      OPENAI_BASE_URL: 'https://api.openai.com',
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      GITHUB_COPILOT_BASE_URL: 'https://api.githubcopilot.com',
      GITHUB_COPILOT_EMBEDDINGS_BASE_URL: 'https://api.githubcopilot.com',
      AUTH_GITHUB_COPILOT: undefined,
      DEFAULT_USERNAME: undefined,
      DEFAULT_PASSWORD: undefined,
      ALLOWED_ORIGINS: '',
      LOG_LEVEL: 'info',
      LOG_FILE: 'logs/app.log',
      BCRYPT_ROUNDS: 10,
      APPROVAL_TIMEOUT_MS: 300000,
      REDIS_URL: 'redis://localhost:6379',
      MCP_SERVERS_PATH: './mcp-servers.json',
      MAX_LLM_ITERATIONS: 2,
      CONVERSATION_HISTORY_WINDOW_SIZE: undefined,
      CONVERSATION_HISTORY_TOKEN_BUDGET: 8000,
      MAX_CONVERSATIONS: 100,
      EMBEDDING_PROVIDER: 'auto',
      EMBEDDING_MODEL_OPENAI: 'text-embedding-nomic-embed-text-v1.5',
      EMBEDDING_MODEL_OLLAMA: 'nomic-embed-text',
      EMBEDDING_MODEL_LOCAL: 'Snowflake/snowflake-arctic-embed-s',
      EMBEDDING_SIMILARITY_THRESHOLD: 0.5,
      EMBEDDING_MIN_PROMPT_WORDS: 4,
      EMBEDDING_CACHE_ENABLED: true,
      EMBEDDING_CACHE_TTL: 3600000,
      USE_DB_CONVERSATION_HISTORY: false,
      OPENWEATHERMAP_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      OUTLOOK_CLIENT_ID: undefined,
      OUTLOOK_TENANT_ID: undefined,
      AUTH_OUTLOOK: undefined,
      GITHUB_COPILOT_CLIENT_ID: 'Ov23liwtwZwa1bIdrSWG',
      XMLTV_PATH: 'logs',
    } as Environment;
  }

  try {
    return envSchema.parse(process.env);
  } catch (error) {
    Logger.error(`Environment validation failed: ${error}`);
    process.exit(1);
  }
}
export const config = validateEnvironment();

export const isProduction = () => config.NODE_ENV === 'production';
export const isDevelopment = () => config.NODE_ENV === 'development';
export const isTest = () => config.NODE_ENV === 'test';