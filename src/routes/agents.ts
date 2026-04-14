import { Request, Response, Router } from "express";
import { z } from 'zod';
import { getAgentFromName, getAvailableAgentNames, getGlobalMCPManager, reinitializeAgentSystem } from '../agent';
import { asyncHandler } from "../utils/asyncHandler";
import Logger from "../utils/logger";
import { slashCommandRegistry } from '../utils/slashCommandRegistry';
import { parseReleases } from '../utils/releaseParser';
import { sendAuthenticationRequired } from "./routeUtils";

export const agentsRouter = Router();

// Version / release notes endpoint
agentsRouter.get("/version", asyncHandler(async (_req: Request, res: Response) => {
   const { current } = parseReleases({ current: true });
   res.json(current);
}));

// List all loaded slash commands and skills (useful for frontend autocomplete)
// Accepts optional ?agent=<name> to filter commands to only those usable by that agent.
agentsRouter.get("/commands", asyncHandler(async (req: Request, res: Response) => {
   slashCommandRegistry.initialize();

   // Resolve the agent's allowed server names (undefined = all servers allowed)
   let agentAllowedServers: string[] | undefined;
   const agentName = typeof req.query.agent === 'string' ? req.query.agent : undefined;
   if (agentName) {
      try {
         const agent = await getAgentFromName(agentName);
         agentAllowedServers = agent.getAllowedServerNames();
         Logger.debug(`[commands] agent="${agentName}" allowedServers=${JSON.stringify(agentAllowedServers)}`);
      } catch {
         // Unknown agent — return all commands unfiltered
         Logger.warn(`[commands] unknown agent="${agentName}", returning all commands unfiltered`);
      }
   }

   const allCommands = slashCommandRegistry.listCommands();
   const commands = allCommands
      .filter(cmd => {
         // If agent has no server restrictions, all commands are available
         if (!agentAllowedServers) return true;
         // If the command has no tool requirements, it's always available
         if (!cmd.allowedTools || cmd.allowedTools.length === 0) return true;
         // Only include command if all its required tools are in the agent's allowed servers
         return cmd.allowedTools.every(tool => agentAllowedServers!.includes(tool));
      })
      .map(cmd => ({
         name: cmd.name,
         description: cmd.description,
         argumentHint: cmd.argumentHint,
         model: cmd.model,
         disableModelInvocation: cmd.disableModelInvocation,
         allowedTools: cmd.allowedTools,
      }));
   const skills = Array.from(slashCommandRegistry.getSkills().keys());
   Logger.debug(`[commands] returning ${commands.length}/${allCommands.length} commands, ${skills.length} skills${agentName ? ` for agent="${agentName}"` : ''}`);
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

// Reinitialize the agent system (e.g. after re-authentication)
agentsRouter.post("/reinitialize", asyncHandler(async (_req: Request, res: Response) => {
   if (!res.locals.session) {
      sendAuthenticationRequired(res);
      return;
   }
   await reinitializeAgentSystem();
   const names = await getAvailableAgentNames();
   res.json({ success: true, agents: names });
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
