import { McpConfigParser } from './configParser';
import { McpConfigError } from './errors';
import fs from 'fs/promises';

jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('McpConfigParser', () => {
   let parser: McpConfigParser;

   beforeEach(() => {
      parser = new McpConfigParser();
      jest.clearAllMocks();
   });

   describe('parseConfigFile', () => {
      it('should parse valid MCP config file', async () => {
         const validConfig = {
            mcp: {
               "test-server": {
                  type: "local",
                  command: ["node", "server.js"],
                  enabled: true
               }
            }
         };

         mockFs.access.mockResolvedValue(undefined);
         mockFs.readFile.mockResolvedValue(JSON.stringify(validConfig));

         const result = await parser.parseConfigFile('test-config.json');

         expect(result).toEqual(validConfig.mcp);
         expect(mockFs.readFile).toHaveBeenCalledWith('test-config.json', 'utf-8');
      });

      it('should return empty config when file does not exist', async () => {
         mockFs.access.mockRejectedValue(new Error('File not found'));

         const result = await parser.parseConfigFile('nonexistent.json');

         expect(result).toEqual({});
      });

      it('should throw McpConfigError for invalid JSON', async () => {
         mockFs.access.mockResolvedValue(undefined);
         mockFs.readFile.mockResolvedValue('invalid json');

         await expect(parser.parseConfigFile('invalid.json'))
            .rejects.toThrow(McpConfigError);
      });

      it('should throw McpConfigError for invalid schema', async () => {
         const invalidConfig = {
            mcp: {
               "test-server": {
                  type: "invalid-type",
                  command: ["node", "server.js"]
               }
            }
         };

         mockFs.access.mockResolvedValue(undefined);
         mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));

         await expect(parser.parseConfigFile('invalid-schema.json'))
            .rejects.toThrow(McpConfigError);
      });
   });

   describe('getEnabledServers', () => {
      it('should return only enabled servers', () => {
         const servers = {
            "enabled-server": {
               type: "local" as const,
               command: ["node", "server.js"],
               enabled: true
            },
            "disabled-server": {
               type: "local" as const,
               command: ["node", "server.js"],
               enabled: false
            },
            "default-enabled": {
               type: "local" as const,
               command: ["node", "server.js"]
            }
         };

         const result = parser.getEnabledServers(servers);

         expect(Object.keys(result)).toHaveLength(2);
         expect(result).toHaveProperty('enabled-server');
         expect(result).toHaveProperty('default-enabled');
         expect(result).not.toHaveProperty('disabled-server');
      });
   });

   describe('createDefaultConfig', () => {
      it('should create default config file', async () => {
         mockFs.mkdir.mockResolvedValue(undefined);
         mockFs.writeFile.mockResolvedValue(undefined);

         await parser.createDefaultConfig('/test/path/config.json');

         expect(mockFs.mkdir).toHaveBeenCalledWith('/test/path', { recursive: true });
         expect(mockFs.writeFile).toHaveBeenCalledWith(
            '/test/path/config.json',
            expect.stringContaining('"mcp"')
         );
      });
   });
});