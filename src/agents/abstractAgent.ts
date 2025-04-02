import { Message, Options } from "ollama";
import { Agent, AgentName } from "../agent";
import Instrumentation from "../utils/instrumentation";
import client from "../utils/ollama";
import { queryDatabase } from "../utils/pgClient";
import { Session } from "../repository/entities/session";

export default abstract class AbstractAgent implements Agent {

   getUserPrompt(question: string): string {
      return `Question: ${question}`;
   }

   getToolSystemPrompt(): string {
      return `
Cutting Knowledge Date: December 2023
Today Date: 23 July 2024
When you receive a tool call response, use the output to format an answer to the orginal user question.
You are a helpful assistant with tool calling capabilities.`;
   }

   getSystemPrompt(): string {
      return `You are a helpful assistant`;
   }

   getAssistantPrompt(): string | undefined {
      return undefined;
   }

   abstract getName(): AgentName;

   abstract getInstrumentation(): Instrumentation;

   getOptions(): Partial<Options> {
      return {
         seed: 123,
         temperature: 1,
      };
   }

   async validate(session: Session, data: any, validate: string): Promise<boolean> {
      const { functions } = this.getInstrumentation().extract();
      const selectedFunction = functions[validate];

      if(!selectedFunction.validation)
         throw new Error(`Invalid function selected: ${validate}`);

      return await selectedFunction.validation(data);
   }

   async askQuestion(session: Session, question: string): Promise<string> {

      const { tools, functions } = this.getInstrumentation().extract();

      const toolSystemPrompt = this.getToolSystemPrompt();

      const systemPrompt = this.getSystemPrompt();

      const userPrompt = this.getUserPrompt(question);

      let messages: Message[] = [{
         role: "system",
         content: toolSystemPrompt
      }, {
         role: "user",
         content: userPrompt
      }];

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
         await this.saveConversation(session, question, functionCallData.message.content);
         return functionCallData.message.content;
      }

      for (let toolContent of toolContents)
         messages.push({ role: "tool", content: toolContent });

      // Add the system prompt to the messages array
      messages[0].content = systemPrompt;

      const answerData = await client.chat({
         model: String(process.env.OLLAMA_MODEL),
         messages,
         stream: false,
         options: this.getOptions()
      });

      const finalAnswer = answerData.message.content;

      await this.saveConversation(session, question, finalAnswer);

      return finalAnswer;
   }

   async saveConversation(session: Session, question: string, answer: string) {
      
      const query = `
       INSERT INTO conversations (question, answer)
       VALUES ($1, $2)
       RETURNING id;
     `;
      
      const result = await queryDatabase(query, [question, answer]);
      
      return result[0]?.id;
   }
}