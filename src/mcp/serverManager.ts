import { spawn } from 'child_process';
import { McpServerInstance } from './types';
import { McpServerConfigSchema, LocalMcpServerSchema, RemoteMcpServerSchema } from './schemas';
import { McpConnectionError, McpServerError } from './errors';
import Logger from '../utils/logger';
import { z } from 'zod';

type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
type LocalMcpServer = z.infer<typeof LocalMcpServerSchema>;
type RemoteMcpServer = z.infer<typeof RemoteMcpServerSchema>;

export class McpServerManager {
   private servers: Map<string, McpServerInstance> = new Map();

   async startServers(serverConfigs: Record<string, McpServerConfig>): Promise<Map<string, McpServerInstance>> {
      const startPromises = Object.entries(serverConfigs).map(async ([name, config]) => {
         try {
            const instance = await this.startServer(name, config);
            this.servers.set(name, instance);
            return instance;
         } catch (error) {
            Logger.error(`Failed to start MCP server '${name}': ${error instanceof Error ? error.message : String(error)}`);
            throw error;
         }
      });

      await Promise.allSettled(startPromises);
      return this.servers;
   }

   private async startServer(name: string, config: McpServerConfig): Promise<McpServerInstance> {
      const instance: McpServerInstance = {
         name,
         config,
         isRunning: false,
         tools: []
      };

      if (config.type === 'local') {
         await this.startLocalServer(instance, config);
      } else if (config.type === 'remote') {
         await this.connectRemoteServer(instance, config);
      }

      return instance;
   }

   private async startLocalServer(instance: McpServerInstance, config: LocalMcpServer): Promise<void> {
      try {
         const [command, ...args] = config.command;
         
         const childProcess = spawn(command, args, {
            env: { ...process.env, ...config.environment },
            stdio: ['pipe', 'pipe', 'pipe']
         });

         instance.process = childProcess;

         childProcess.on('error', (error) => {
            Logger.error(`MCP server '${instance.name}' process error: ${error.message}`);
            instance.isRunning = false;
         });

         childProcess.on('exit', (code) => {
            Logger.debug(`MCP server '${instance.name}' exited with code ${code}`);
            instance.isRunning = false;
         });

         childProcess.stdout?.on('data', (data) => {
            Logger.debug(`MCP server '${instance.name}' stdout: ${data}`);
         });

         childProcess.stderr?.on('data', (data) => {
            Logger.debug(`MCP server '${instance.name}' stderr: ${data}`);
         });

         await this.waitForServerReady(instance);
         instance.isRunning = true;

         Logger.info(`Started local MCP server '${instance.name}'`);
      } catch (error) {
         throw new McpServerError(`Failed to start local MCP server '${instance.name}': ${error instanceof Error ? error.message : String(error)}`);
      }
   }

   private async connectRemoteServer(instance: McpServerInstance, config: RemoteMcpServer): Promise<void> {
      try {
         const headers = config.headers || {};
         
         const response = await fetch(config.url, {
            method: 'GET',
            headers: {
               'Content-Type': 'application/json',
               ...headers
            }
         });

         if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
         }

         instance.connection = {
            url: config.url,
            headers
         };
         
         instance.isRunning = true;
         Logger.info(`Connected to remote MCP server '${instance.name}' at ${config.url}`);
      } catch (error) {
         throw new McpConnectionError(`Failed to connect to remote MCP server '${instance.name}': ${error instanceof Error ? error.message : String(error)}`);
      }
   }

   private async waitForServerReady(instance: McpServerInstance): Promise<void> {
      return new Promise((resolve, reject) => {
         const timeout = setTimeout(() => {
            reject(new Error(`Server startup timeout for '${instance.name}'`));
         }, 10000);

         setTimeout(() => {
            clearTimeout(timeout);
            resolve();
         }, 2000);
      });
   }

   async stopServer(name: string): Promise<void> {
      const instance = this.servers.get(name);
      if (!instance) {
         return;
      }

      if (instance.process) {
         instance.process.kill();
      }

      instance.isRunning = false;
      this.servers.delete(name);
      Logger.info(`Stopped MCP server '${name}'`);
   }

   async stopAllServers(): Promise<void> {
      const stopPromises = Array.from(this.servers.keys()).map(name => this.stopServer(name));
      await Promise.allSettled(stopPromises);
   }

   getRunningServers(): McpServerInstance[] {
      return Array.from(this.servers.values()).filter(server => server.isRunning);
   }

   getServer(name: string): McpServerInstance | undefined {
      return this.servers.get(name);
   }

   async discoverTools(serverName: string): Promise<any[]> {
      const instance = this.servers.get(serverName);
      if (!instance || !instance.isRunning) {
         throw new McpServerError(`MCP server '${serverName}' is not running`);
      }

      try {
         if (instance.config.type === 'local') {
            return await this.discoverLocalTools(instance);
         } else {
            return await this.discoverRemoteTools(instance);
         }
      } catch (error) {
         throw new McpServerError(`Failed to discover tools for '${serverName}': ${error instanceof Error ? error.message : String(error)}`);
      }
   }

   private async discoverLocalTools(_instance: McpServerInstance): Promise<any[]> {
      return [];
   }

   private async discoverRemoteTools(instance: McpServerInstance): Promise<any[]> {
      if (!instance.connection) {
         throw new Error('No connection available');
      }

      const response = await fetch(`${instance.connection.url}/tools`, {
         headers: instance.connection.headers
      });

      if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
   }
}