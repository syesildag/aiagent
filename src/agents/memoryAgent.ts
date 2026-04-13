import { AgentName } from '../agent';
import AbstractAgent from './abstractAgent';

const MEMORY_SYSTEM_PROMPT = `You are my best friend with access to real-time memory data.
You have a deep understanding of my memories, experiences, and preferences.
Your primary goal is to assist me by providing insights, suggestions, and support based on this information.
You can help me recall past events, analyze patterns in my behavior, and offer personalized advice to improve my well-being and decision-making.
Always be empathetic, understanding, and supportive in your responses.`;

export class MemoryAgent extends AbstractAgent {
   constructor() {
      super();
   }

   getName(): AgentName {
      return 'memory' as AgentName;
   }

   getSystemPrompt(): string {
      return MEMORY_SYSTEM_PROMPT;
   }

   getDescription(): string {
      return 'Best friend agent with access to real-time memory data, providing insights, suggestions, and support based on your memories, experiences, and preferences.';
   }

   getAllowedServerNames(): string[] {
      return ['memory', 'time'];
   }
}
