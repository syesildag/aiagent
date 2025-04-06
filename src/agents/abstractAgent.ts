import { Message, Options } from "ollama";
import { Agent, AgentName } from "../agent";
import { Session } from "../repository/entities/session";
import Instrumentation from "../utils/instrumentation";
import Logger from "../utils/logger";
import client from "../utils/ollama";
import { queryDatabase } from "../utils/pgClient";

export default abstract class AbstractAgent implements Agent {

   private session?: Session;

   getUserPrompt(question: string): string {
      return `Question: ${question}`;
   }

   getToolSystemPrompt(): string | undefined{
      return undefined;
   }

   getSystemPrompt(): string | undefined {
      return undefined;
   }

   getAssistantPrompt(): string | undefined {
      return undefined;
   }

   abstract getName(): AgentName;

   abstract getInstrumentation(): Instrumentation;

   setSession(session: Session) {
      this.session = session;
   }

   getSession(): Session | undefined {
      return this.session;
   }

   getOptions(): Partial<Options> {
      return {
         seed: 123,
         temperature: 0,
      };
   }

   shouldValidate(): boolean {
      return false;
   }

   async validate(data: any): Promise<boolean> {
      return false;
   }

   async chat(prompt: string): Promise<string> {

      const { tools, functions } = this.getInstrumentation().extract();

      const toolSystemPrompt = this.getToolSystemPrompt();

      const systemPrompt = this.getSystemPrompt();

      const userPrompt = this.getUserPrompt(prompt);

      let messages: Message[] = [];

      if(!!toolSystemPrompt) {
         messages.push({
            role: "system",
            content: toolSystemPrompt
         });
      }

      messages.push({
         role: "user",
         content: userPrompt
      });

      const assistantPrompt = this.getAssistantPrompt();
      if (assistantPrompt) {
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
                  throw new Error(`Invalid tool selected: ${JSON.stringify(func)}`);
               return await selectedFunction.implementation(args);
            }));
            toolContents.push(...results);
         }
         catch (error) {
            console.error("Error: ", error);
         }
      }
      else {
         await this.saveConversation(prompt, functionCallData.message.content);
         return functionCallData.message.content;
      }

      for (let toolContent of toolContents)
         messages.push({ role: "tool", content: toolContent });

      const systemMessage = messages.find((message) => message.role === "system");

      if (systemPrompt) {
         if(systemMessage)
            systemMessage.content = systemPrompt;
         else
            messages.unshift({
               role: "system",
               content: systemPrompt
            });
      }
      else
         messages = messages.filter((message) => message.role !== "system");

      Logger.debug(`Messages after tool call: ${JSON.stringify(messages)}`);

      const answerData = await client.chat({
         model: String(process.env.OLLAMA_MODEL),
         messages,
         stream: false,
         options: this.getOptions()
      });

      const finalAnswer = answerData.message.content;

      await this.saveConversation(prompt, finalAnswer);

      return finalAnswer;
   }

   async saveConversation(question: string, answer: string) {

      const query = `
       INSERT INTO conversations (question, answer)
       VALUES ($1, $2)
       RETURNING id;
     `;

      const result = await queryDatabase(query, [question, answer]);

      return result[0]?.id;
   }
}