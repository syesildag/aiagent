import { Message, Options } from 'ollama';
import Instrumentation from './utils/instrumentation';
import client from './utils/ollama';
import { queryDatabase } from './utils/pgClient';

import WeatherAgent from './agents/weatherAgent';
import DatabaseAgent from './agents/databaseAgent';

export type AgentName =
"weather" |
"database";

export interface Agent {
   getSystemPrompt(): string;
   getUserPrompt(question: string): string;
   getAssistantPrompt?(): string;
   getName(): AgentName;
   getInstrumentation(): Instrumentation;
   getOptions?(): Partial<Options>;
}

const Agents: Record<AgentName, Agent> = [
   WeatherAgent,
   DatabaseAgent
].reduce((acc, agent) => {
   acc[agent.getName()] = agent;
   return acc;
} , {} as Record<AgentName, Agent>);

export const askQuestionWithFunctions = async (session: string, agentName: string, question: string): Promise<string> => {

   const agent = Agents[agentName as AgentName];
   if (!agent)
      throw new Error(`Invalid agent selected: ${agentName}`);

   const {tools, functions} = agent.getInstrumentation().extract();

   const systemPrompt = agent.getSystemPrompt();

   const userPrompt = agent.getUserPrompt(question);

   let messages: Message[] = [{
      role: "system",
      content: systemPrompt
   }, {
      role: "user",
      content: userPrompt
   }];

   const assistantPrompt = agent.getAssistantPrompt?.();
   if(assistantPrompt) {
      messages.push({
         role: "assistant",
         content: assistantPrompt
      });
   }

   let functionCallData = await client.chat({
      model: String(process.env.OLLAMA_MODEL),
      messages,
      stream: false,
      tools
   });

   let toolContents: any[] = [];
   let toolCalls = functionCallData.message.tool_calls;
   if (!!toolCalls) {
      try {
         var results = await Promise.all(toolCalls.map(async (toolCall) => {
            const func = toolCall.function;
            const name = func.name;
            const args = func.arguments;
            const selectedFunction = functions[name];
            if (!selectedFunction)
               throw new Error(`Invalid tool selected: ${name}`);
            return await selectedFunction.implementation(args);
         }));
         toolContents.push(...results);
      }
      catch (error) {
         console.error("Error: ", error);
         return "";
      }
   }
   else {
      await saveConversation(session, question, functionCallData.message.content);
      return functionCallData.message.content;
   }

   messages.push(functionCallData.message);

   for (let toolContent of toolContents)
      messages.push({ role: "tool", content: toolContent });

   const answerData = await client.chat({
      model: String(process.env.OLLAMA_MODEL),
      messages,
      stream: false,
      options: agent.getOptions?.()
   });

   const finalAnswer = answerData.message.content;

   await saveConversation(session, question, finalAnswer);

   return finalAnswer;
};

export const saveConversation = async (session: string, question: string, answer: string) => {

   const query = `
    INSERT INTO conversations (question, answer)
    VALUES ($1, $2)
    RETURNING id;
  `;

   const result = await queryDatabase(query, [question, answer]);

   return result[0]?.id;
};