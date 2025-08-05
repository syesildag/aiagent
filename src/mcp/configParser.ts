import fs from 'fs/promises';
import path from 'path';
import { McpConfigFileSchema, McpServerConfigSchema } from './schemas';
import { McpConfigError } from './errors';
import Logger from '../utils/logger';
import { z } from 'zod';

type McpConfigFile = z.infer<typeof McpConfigFileSchema>;
type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export class McpConfigParser {
   
   async parseConfigFile(configPath: string): Promise<Record<string, McpServerConfig>> {
      try {
         const configExists = await this.checkConfigExists(configPath);
         if (!configExists) {
            Logger.debug(`MCP config file not found at ${configPath}, using empty config`);
            return {};
         }

         const configContent = await fs.readFile(configPath, 'utf-8');
         const rawConfig = JSON.parse(configContent);
         
         const validatedConfig = this.validateConfig(rawConfig);
         
         Logger.debug(`Loaded MCP config with ${Object.keys(validatedConfig.mcp).length} servers`);
         
         return validatedConfig.mcp;
      } catch (error) {
         if (error instanceof McpConfigError) {
            throw error;
         }
         throw new McpConfigError(`Failed to parse MCP config file: ${error instanceof Error ? error.message : String(error)}`);
      }
   }

   private async checkConfigExists(configPath: string): Promise<boolean> {
      try {
         await fs.access(configPath);
         return true;
      } catch {
         return false;
      }
   }

   private validateConfig(rawConfig: any): McpConfigFile {
      try {
         return McpConfigFileSchema.parse(rawConfig);
      } catch (error) {
         throw new McpConfigError(`Invalid MCP config format: ${error instanceof Error ? error.message : String(error)}`);
      }
   }

   getEnabledServers(servers: Record<string, McpServerConfig>): Record<string, McpServerConfig> {
      const enabledServers: Record<string, McpServerConfig> = {};
      
      for (const [name, config] of Object.entries(servers)) {
         if (config.enabled !== false) {
            enabledServers[name] = config;
         }
      }
      
      return enabledServers;
   }

   async createDefaultConfig(configPath: string): Promise<void> {
      const defaultConfig: McpConfigFile = {
         mcp: {
            "example-local": {
               type: "local",
               command: ["node", "example-server.js"],
               environment: {
                  "NODE_ENV": "production"
               },
               enabled: false
            },
            "example-remote": {
               type: "remote",
               url: "https://api.example.com/mcp",
               headers: {
                  "Authorization": "Bearer your-token-here"
               },
               enabled: false
            }
         }
      };

      const configDir = path.dirname(configPath);
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
      
      Logger.info(`Created default MCP config at ${configPath}`);
   }
}