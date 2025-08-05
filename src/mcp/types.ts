import { z } from 'zod';
import { McpServerConfigSchema } from './schemas';

export interface McpServerInstance {
   name: string;
   config: z.infer<typeof McpServerConfigSchema>;
   process?: any;
   connection?: any;
   tools?: any[];
   isRunning: boolean;
}