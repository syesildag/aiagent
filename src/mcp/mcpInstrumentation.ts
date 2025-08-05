import { McpServerInstance } from './types';
import { McpToolExecutor } from './toolExecutor';
import Instrumentation from '../utils/instrumentation';

export class McpInstrumentation extends Instrumentation {
   private toolExecutor: McpToolExecutor;
   private serverInstance: McpServerInstance;
   private mcpFunctions: { [fnName: string]: any } = {};
   private mcpTools: any[] = [];

   constructor(serverInstance: McpServerInstance) {
      // Call parent constructor with empty descriptions array
      super();
      this.serverInstance = serverInstance;
      this.toolExecutor = new McpToolExecutor(serverInstance);
      this.initializeMcpTools();
   }

   private initializeMcpTools(): void {
      this.mcpTools = this.generateMcpTools();
      this.mcpFunctions = this.createFunctionMap(this.mcpTools);
   }

   private generateMcpTools(): any[] {
      const availableTools = this.serverInstance.tools || [];
      
      return availableTools.map(tool => ({
         type: "function",
         function: {
            name: tool.name,
            description: tool.description || `Execute ${tool.name} tool from MCP server ${this.serverInstance.name}`,
            parameters: tool.inputSchema || {
               type: "object",
               properties: {
                  input: {
                     type: "string",
                     description: "Input parameters for the tool"
                  }
               },
               required: ["input"]
            }
         }
      }));
   }

   private createFunctionMap(tools: any[]): { [fnName: string]: any } {
      const functionMap: { [fnName: string]: any } = {};
      
      tools.forEach(tool => {
         const toolName = tool.function.name;
         functionMap[toolName] = {
            name: toolName,
            description: tool.function.description,
            parameters: tool.function.parameters,
            implementation: async (args: any) => {
               try {
                  return await this.toolExecutor.executeTool(toolName, args);
               } catch (error) {
                  throw new Error(`MCP tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
               }
            }
         };
      });

      return functionMap;
   }

   // Override extract method to provide MCP-specific tools
   extract(): { tools: any[], functions: { [fnName: string]: any } } {
      // Combine parent tools/functions with MCP tools/functions
      const parentExtract = super.extract();
      
      return {
         tools: [...parentExtract.tools, ...this.mcpTools],
         functions: { ...parentExtract.functions, ...this.mcpFunctions }
      };
   }
}