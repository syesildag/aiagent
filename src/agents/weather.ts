import { Options } from "ollama";
import fetchCurrentWeather from "../descriptions/currentWeather";
import { AIAgent, AIAgentName } from "../utils/aiAgent";
import Instrumentation from "../utils/instrumentation";

class WeatherAgent implements AIAgent {

   getSystemPrompt(): string {
      return `
Cutting Knowledge Date: December 2023
Today Date: 23 July 2024

When you receive a tool call response, use the output to format an answer to the orginal user question.

You are a helpful assistant like JARVIS in Iron Man with tool calling capabilities.`;
   }

   getName(): AIAgentName {
      return "weather";
   }

   getInstrumentation() {
      return new Instrumentation(fetchCurrentWeather);
   }

   getOptions(): Partial<Options> {
      return {
         seed: 123,
         temperature: 1,
      };
   }
}

export default new WeatherAgent();