import { Request, Response, Router } from "express";
import { z } from 'zod';
import { getAgentFromName, getAvailableAgentNames, getGlobalMCPManager } from '../agent';
import { asyncHandler } from "../utils/asyncHandler";
import Logger from "../utils/logger";
import { slashCommandRegistry } from '../utils/slashCommandRegistry';

export const agentsRouter = Router();

function sendAuthenticationRequired(res: Response) {
   res.status(401).json({ error: 'Authentication required.' });
}

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
