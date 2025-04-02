import { Description, makeTool } from './makeTool';
import { z } from 'zod';

interface ToolFunction {
   name: any;
   description: any;
   parameters: any;
}

interface Tool {
   type: string;
   function: ToolFunction;
}

export default class Instrumentation {

   private functions: { [fnName: string]: Description<z.ZodObject<any>> };

   private tools: Tool[];

   constructor(...descriptions: Description<any>[]) {

      this.functions = descriptions.reduce((acc, d) => {
         acc[d.name] = makeTool(d);
         return acc;
      }, {} as { [fnName: string]: any });

      this.tools = Object.values(this.functions).map(fn => ({
         type: "function",
         function: {
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters,
         }
      }));
   }

   extract() {
      return {
         functions: this.functions,
         tools: this.tools,
      };
   }
}