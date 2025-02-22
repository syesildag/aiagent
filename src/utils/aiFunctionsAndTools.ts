
import fetchConversations from '../functions/fetchConversation';
import fetchCurrentWeather from '../functions/fetchCurrentWeather';
import fetchDocuments from '../functions/fetchDocuments';
import fetchSQL from '../functions/fetchSQL';
import { makeTool } from './makeTool';

export const functions = [
   fetchConversations,
   fetchCurrentWeather,
   fetchSQL,
   fetchDocuments
].reduce((acc, d) => {
   acc[d.name] = makeTool(d);
   return acc;
}, {} as { [fnName: string]: any });

export const tools = Object.values(functions).map(fn => ({
   type: "function",
   function: {
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
   }
}));