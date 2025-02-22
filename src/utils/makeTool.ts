import { z } from 'zod';
import { zodToJsonSchema } from "zod-to-json-schema";

export interface Description<T extends z.ZodObject<any>> {
   name: string;
   description: string;
   parameters: T;
   implementation: (params: z.infer<T>) => Promise<any>;
}

export function makeTool(d: Description<any>) {
   return {
      name: d.name,
      description: d.description,
      parameters: zodToJsonSchema(d.parameters, "schema").definitions?.schema,
      implementation: d.implementation
   };
}