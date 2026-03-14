import { Request, Response, Router } from "express";
import { z } from 'zod';
import { getAgentFromName, getAvailableAgentNames, getGlobalMCPManager } from '../agent';
import { asyncHandler } from "../utils/asyncHandler";
import Logger from "../utils/logger";
import { slashCommandRegistry } from '../utils/slashCommandRegistry';
import { parseReleases } from '../utils/releaseParser';

export const agentsRouter = Router();

function sendAuthenticationRequired(res: Response) {
   res.status(401).json({ error: 'Authentication required.' });
}

// Version / release notes endpoint
agentsRouter.get("/version", asyncHandler(async (_req: Request, res: Response) => {
   const { current } = parseReleases({ current: true });
   res.json(current);
}));

// List all loaded slash commands and skills (useful for frontend autocomplete)
agentsRouter.get("/commands", asyncHandler(async (_req: Request, res: Response) => {
   slashCommandRegistry.initialize();
   const commands = slashCommandRegistry.listCommands().map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      argumentHint: cmd.argumentHint,
      model: cmd.model,
      disableModelInvocation: cmd.disableModelInvocation,
      allowedTools: cmd.allowedTools,
   }));
   const skills = Array.from(slashCommandRegistry.getSkills().keys());
   res.json({ commands, skills });
}));

// List available agents
agentsRouter.get("/agents", asyncHandler(async (_req: Request, res: Response) => {
   const names = await getAvailableAgentNames();
   res.json({ agents: names });
}));

// Info endpoint - returns current model, provider and all available models for the agent
agentsRouter.get("/info/:agent", asyncHandler(async (req: Request, res: Response) => {
   await getAgentFromName(req.params.agent); // validates agent exists
   const manager = getGlobalMCPManager();
   const models = manager ? await manager.getAvailableModels() : [];
   res.json({
      model: manager?.getCurrentModel() ?? '',
      provider: manager?.getProviderName() ?? '',
      models
   });
}));

// MCP tools cache status — unauthenticated, returns formatted markdown
agentsRouter.get("/mcp-status", asyncHandler(async (_req: Request, res: Response) => {
   const manager = getGlobalMCPManager();
   if (!manager) {
      res.type('text').send('MCP manager not initialised yet.');
      return;
   }

   const serverStatus = manager.getServerStatus();
   const cacheValid = manager.isToolsCacheValid();
   const cachedCount = manager.getCachedToolsCount();
   const toolsByServer = manager.getToolsByServer();

   const lines: string[] = [];
   lines.push('## MCP Tools Cache');
   lines.push(`- **Cache valid:** ${cacheValid}`);
   lines.push(`- **Total cached tools:** ${cachedCount}`);
   lines.push('');

   for (const [serverName, info] of Object.entries(serverStatus)) {
      const serverTools = toolsByServer[serverName] ?? [];
      lines.push(`### ${serverName} (${info.running ? 'running' : 'stopped'})`);
      lines.push(`- Tools: ${info.tools.length} | Resources: ${info.resources.length} | Prompts: ${info.prompts.length}`);
      if (serverTools.length > 0) {
         lines.push('');
         lines.push('**Cached tools:**');
         for (const tool of serverTools) {
            lines.push(`- \`${tool.function.name}\` — ${tool.function.description}`);
         }
      }
      lines.push('');
   }

   res.type('text').send(lines.join('\n'));
}));

// Model switch endpoint - changes the active model
agentsRouter.post("/model/:agent", asyncHandler(async (req: Request, res: Response) => {
   if (!res.locals.session) {
      sendAuthenticationRequired(res);
      return;
   }
   await getAgentFromName(req.params.agent);
   const { model } = z.object({ model: z.string().min(1).max(200) }).parse(req.body);
   const manager = getGlobalMCPManager();
   if (!manager) {
      res.status(503).json({ error: 'Agent not initialised' });
      return;
   }
   manager.updateModel(model);
   Logger.info(`Model switched to: ${model}`);
   res.json({ model });
}));
