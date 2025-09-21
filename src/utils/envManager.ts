import * as fs from 'fs';
import * as path from 'path';
import Logger from './logger';

/**
 * Get the path to the .env file
 */
function getEnvPath(): string {
  return path.join(process.cwd(), '.env');
}

/**
 * Read the content of the .env file
 */
function readEnvContent(): string {
  const envPath = getEnvPath();
  
  if (fs.existsSync(envPath)) {
    return fs.readFileSync(envPath, 'utf8');
  }
  
  return '';
}

/**
 * Write content to the .env file
 */
function writeEnvContent(content: string): void {
  const envPath = getEnvPath();
  fs.writeFileSync(envPath, content, 'utf8');
}

/**
 * Check if a line contains a specific environment variable
 */
function lineContainsKey(line: string, key: string): boolean {
  const trimmedLine = line.trim();
  return trimmedLine.startsWith(`${key}=`) || trimmedLine.startsWith(`${key} =`);
}

/**
 * Update environment variable in .env file
 */
export function updateEnvVariable(key: string, value: string): void {
  updateEnvVariables({ [key]: value });
}

/**
 * Update multiple environment variables at once
 */
export function updateEnvVariables(updates: Record<string, string>): void {
  try {
    const envContent = readEnvContent();
    const lines = envContent.split('\n');
    const keysToUpdate = Object.keys(updates);
    const foundKeys = new Set<string>();
    
    // Update existing keys
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const key of keysToUpdate) {
        if (lineContainsKey(line, key)) {
          lines[i] = `${key}=${updates[key]}`;
          foundKeys.add(key);
          break;
        }
      }
    }
    
    // Add new keys that weren't found
    for (const key of keysToUpdate) {
      if (!foundKeys.has(key)) {
        lines.push(`${key}=${updates[key]}`);
      }
    }
    
    // Write back to file
    const newContent = lines.join('\n');
    writeEnvContent(newContent);
    
    // Update process.env in memory
    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
    }
    
    const keyList = keysToUpdate.join(', ');
    const message = keysToUpdate.length === 1 
      ? `Updated ${keyList} in .env file and memory`
      : `Updated environment variables: ${keyList} in .env file and memory`;
    Logger.info(message);
  } catch (error) {
    Logger.error(`Failed to update .env file: ${error}`);
    throw error;
  }
}

/**
 * Read environment variable from .env file
 */
export function readEnvVariable(key: string): string | null {
  try {
    const envContent = readEnvContent();
    
    if (!envContent) {
      return null;
    }
    
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      if (lineContainsKey(line, key)) {
        const equalIndex = line.indexOf('=');
        return line.substring(equalIndex + 1).trim();
      }
    }
    
    return null;
  } catch (error) {
    Logger.error(`Failed to read .env file: ${error}`);
    return null;
  }
}