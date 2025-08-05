import { z } from 'zod';

export const LocalMcpServerSchema = z.object({
   type: z.literal("local"),
   command: z.array(z.string()),
   environment: z.record(z.string()).optional(),
   enabled: z.boolean().optional()
});

export const RemoteMcpServerSchema = z.object({
   type: z.literal("remote"),
   url: z.string(),
   enabled: z.boolean().optional(),
   headers: z.record(z.string()).optional()
});

export const McpServerConfigSchema = z.union([
   LocalMcpServerSchema,
   RemoteMcpServerSchema
]);

export const McpConfigFileSchema = z.object({
   mcp: z.record(McpServerConfigSchema)
});