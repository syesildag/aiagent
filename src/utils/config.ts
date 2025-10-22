import { z } from 'zod';
import * as dotenv from 'dotenv';
import Logger from './logger';

dotenv.config();

const envSchema = z.object({
  GITHUB_COPILOT_CLIENT_ID: z.string().min(1).default('Iv1.b507a08c87ecfe98'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  HOST: z.string().min(1),
  SERVER_TERMINATE_TIMEOUT: z.string().transform(Number).pipe(z.number().positive()),
  DB_USER: z.string().min(1),
  DB_HOST: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_PASSWORD: z.string().optional(),
  DB_PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  DB_POOL_MAX: z.string().transform(Number).pipe(z.number().min(1).max(100)).default('20'),
  DB_POOL_IDLE_TIMEOUT_MS: z.string().transform(Number).pipe(z.number().min(1000)).default('30000'),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.string().transform(Number).pipe(z.number().min(500)).default('2000'),
  HMAC_SECRET_KEY: z.string().min(32),
  SESSION_TIMEOUT_SECONDS: z.string().transform(Number).pipe(z.number().positive()).default('3600'),
  LLM_PROVIDER: z.enum(['ollama', 'openai', 'github']).default('ollama'),
  LLM_MODEL: z.string().min(1).default('qwen3:4b'),
  OLLAMA_HOST: z.string().url().default('http://localhost:11434'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),
  GITHUB_COPILOT_BASE_URL: z.string().url().default('https://api.githubcopilot.com'),
  GITHUB_COPILOT_EMBEDDINGS_BASE_URL: z.string().url().default('https://copilot-proxy.githubusercontent.com'),
  AUTH_GITHUB_COPILOT: z.string().optional(),
  DEFAULT_USERNAME: z.string().min(1).default('default_username'),
  DEFAULT_PASSWORD: z.string().min(1).default('default_password'),
  OPENWEATHERMAP_API_KEY: z.string().min(1).optional(),
  MCP_SERVERS_PATH: z.string().min(1).default('./mcp-servers.json'),
  MAX_LLM_ITERATIONS: z.string().transform(Number).pipe(z.number().min(1).max(10)).default('2'),
  CONVERSATION_HISTORY_WINDOW_SIZE: z.string().transform(Number).pipe(z.number().min(1)).default('10'),
  USE_DB_CONVERSATION_HISTORY: z.string().transform((val) => val === 'true').default('false'),
  EMBEDDING_PROVIDER: z.enum(['openai', 'ollama', 'local', 'github', 'auto']).default('auto'),
  EMBEDDING_MODEL_OPENAI: z.string().default('text-embedding-3-small'),
  EMBEDDING_MODEL_OLLAMA: z.string().default('nomic-embed-text'),
  EMBEDDING_CACHE_ENABLED: z.string().transform((val) => val === 'true').default('true'),
  EMBEDDING_CACHE_TTL: z.string().transform(Number).pipe(z.number().positive()).default('3600000'), // 1 hour
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
      DB_POOL_CONNECTION_TIMEOUT_MS: 2000,
      HMAC_SECRET_KEY: 'test_hmac_key_at_least_32_characters_long_for_security',
      SESSION_TIMEOUT_SECONDS: 86400,
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'test',
      OLLAMA_HOST: 'http://localhost:11434',
      OPENAI_BASE_URL: 'https://api.openai.com',
      GITHUB_COPILOT_BASE_URL: 'https://api.githubcopilot.com',
      GITHUB_COPILOT_EMBEDDINGS_BASE_URL: 'https://copilot-proxy.githubusercontent.com',
      AUTH_GITHUB_COPILOT: undefined,
      DEFAULT_USERNAME: 'default_username',
      DEFAULT_PASSWORD: 'default_password',
      REDIS_URL: 'redis://localhost:6379',
      MCP_SERVERS_PATH: './mcp-servers.json',
      MAX_LLM_ITERATIONS: 2,
      CONVERSATION_HISTORY_WINDOW_SIZE: 10,
      EMBEDDING_PROVIDER: 'auto',
      EMBEDDING_MODEL_OPENAI: 'text-embedding-3-small',
      EMBEDDING_MODEL_OLLAMA: 'nomic-embed-text',
      EMBEDDING_CACHE_ENABLED: true,
      EMBEDDING_CACHE_TTL: 3600000,
      USE_DB_CONVERSATION_HISTORY: false,
      OPENWEATHERMAP_API_KEY: undefined,
      GITHUB_COPILOT_CLIENT_ID: 'Ov23liwtwZwa1bIdrSWG',
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