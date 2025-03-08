import { Options } from "ollama";
import { Agent, AgentName } from "../agent";
import Instrumentation from "../utils/instrumentation";

export default abstract class AbstractAgent implements Agent {

   getUserPrompt(question: string): string {
      return `Question: ${question}`;
   }

   getSystemPrompt(): string {
      return `
Cutting Knowledge Date: December 2023
Today Date: 23 July 2024

When you receive a tool call response, use the output to format an answer to the orginal user question.

You are a helpful assistant with tool calling capabilities.`;
   }

   abstract getName(): AgentName;

   abstract getInstrumentation(): Instrumentation;

   getOptions(): Partial<Options> {
      return {
         seed: 123,
         temperature: 1,
      };
   }
}