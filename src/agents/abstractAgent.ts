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

   getToolSystemPrompt(): string {
      return `
You are an expert in composing functions. You are given a question and a set of possible functions.
Based on the question, you will need to make one or more function/tool calls to achieve the purpose.
If none of the functions can be used, point it out. If the given question lacks the parameters required by the function,also point it out. You should only return the function call in tools call sections.
If you decide to invoke any of the function(s), you MUST put it in the format of [func_name1(params_name1=params_value1, params_name2=params_value2...), func_name2(params)]
You SHOULD NOT include any other text in the response.`;
   }

   getSystemPrompt(): string | undefined {
      return `
      Current date time is: ${new Date().toISOString()}
      You are a helpful assistant like JARVIS in Iron Man who gives succint answers in the user's chosen language.`;
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

      if (systemPrompt)
         // Add the system prompt to the messages array
         messages[0].content = systemPrompt;
      else
         messages.shift();

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