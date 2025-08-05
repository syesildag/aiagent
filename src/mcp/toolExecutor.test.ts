import { McpToolExecutor } from './toolExecutor';
import { McpServerInstance } from './types';
import { McpServerError } from './errors';

describe('McpToolExecutor', () => {
   let mockServerInstance: McpServerInstance;
   let toolExecutor: McpToolExecutor;

   beforeEach(() => {
      mockServerInstance = {
         name: 'test-server',
         config: {
            type: 'local',
            command: ['node', 'test-server.js'],
            enabled: true
         },
         isRunning: true,
         tools: [
            { name: 'test-tool', description: 'A test tool' }
         ]
      };
      
      toolExecutor = new McpToolExecutor(mockServerInstance);
   });

   describe('executeTool', () => {
      it('should throw error if server is not running', async () => {
         mockServerInstance.isRunning = false;

         await expect(toolExecutor.executeTool('test-tool', {}))
            .rejects.toThrow(McpServerError);
      });

      it('should execute remote tool via HTTP request', async () => {
         mockServerInstance.config = {
            type: 'remote',
            url: 'https://api.example.com/mcp',
            enabled: true
         };
         
         mockServerInstance.connection = {
            url: 'https://api.example.com/mcp',
            headers: {}
         };

         // Mock fetch
         global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: 'Remote tool executed' })
         });

         const result = await toolExecutor.executeTool('test-tool', { input: 'test' });
         
         expect(global.fetch).toHaveBeenCalledWith(
            'https://api.example.com/mcp/tools/call',
            expect.objectContaining({
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: expect.stringContaining('test-tool')
            })
         );
         
         expect(result).toBe('Remote tool executed');
      });

      it('should handle remote tool HTTP errors', async () => {
         mockServerInstance.config = {
            type: 'remote',
            url: 'https://api.example.com/mcp',
            enabled: true
         };
         
         mockServerInstance.connection = {
            url: 'https://api.example.com/mcp',
            headers: {}
         };

         // Mock fetch to return error
         global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error'
         });

         await expect(toolExecutor.executeTool('test-tool', { input: 'test' }))
            .rejects.toThrow(McpServerError);
      });
   });

   describe('getAvailableTools', () => {
      it('should return list of available tool names', () => {
         const tools = toolExecutor.getAvailableTools();
         expect(tools).toEqual(['test-tool']);
      });

      it('should return empty array if no tools available', () => {
         mockServerInstance.tools = undefined;
         const tools = toolExecutor.getAvailableTools();
         expect(tools).toEqual([]);
      });
   });
});