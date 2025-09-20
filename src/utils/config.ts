import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  HOST: z.string().min(1),
  SERVER_TERMINATE_TIMEOUT: z.string().transform(Number).pipe(z.number().positive()),
  
  // Database
  DB_USER: z.string().min(1),
  DB_HOST: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  
  // LLM Configuration
  LLM_PROVIDER: z.enum(['ollama', 'openai', 'github']).default('ollama'),
  LLM_MODEL: z.string().min(1).default('qwen3:4b'),
  
  // Ollama
  OLLAMA_HOST: z.string().url().default('http://localhost:11434'),
  
  // OpenAI
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),
  
  // GitHub Copilot
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_COPILOT_BASE_URL: z.string().url().default('https://api.githubcopilot.com'),
  
  // External APIs
  OPENWEATHER_API_KEY: z.string().min(1).optional(),
  
  // MCP Configuration
  MCP_SERVERS_PATH: z.string().min(1).default('./mcp-servers.json'),
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
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'test',
      OLLAMA_HOST: 'http://localhost:11434',
      OPENAI_BASE_URL: 'https://api.openai.com',
      GITHUB_COPILOT_BASE_URL: 'https://api.githubcopilot.com',
      MCP_SERVERS_PATH: './mcp-servers.json',
    } as Environment;
  }

  try {
    return envSchema.parse(process.env);
  } catch (error) {
    console.error(`Environment validation failed: ${error}`);
    process.exit(1);
  }
}
export const config = validateEnvironment();

export const isProduction = () => config.NODE_ENV === 'production';
export const isDevelopment = () => config.NODE_ENV === 'development';
export const isTest = () => config.NODE_ENV === 'test';