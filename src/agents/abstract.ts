import { Options } from "ollama";
import { AIAgent, AIAgentName } from "../utils/aiAgent";
import Instrumentation from "../utils/instrumentation";

export default abstract class AbstractAgent implements AIAgent {

   getUserPrompt(question: string): string {
      return `Question: ${question}`;
   }

   getSystemPrompt(): string {
      return `
Cutting Knowledge Date: December 2023
Today Date: 23 July 2024

When you receive a tool call response, use the output to format an answer to the orginal user question.

You are a helpful assistant like JARVIS in Iron Man with tool calling capabilities.`;
   }

   abstract getName(): AIAgentName;

   abstract getInstrumentation(): Instrumentation;

   getOptions(): Partial<Options> {
      return {
         seed: 123,
         temperature: 1,
      };
   }
}