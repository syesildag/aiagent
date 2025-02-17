import { functions } from './aiFunctions';
import client from './ollama';
import { queryDB } from './pgClient';

export const askQuestionWithFunctions = async (question: string): Promise<string> => {

   // Step 2: Build the prompt for function calling
   const tools = Object.values(functions).map(fn => ({
      type: "function",
      function: {
         name: fn.name,
         description: fn.description,
         parameters: fn.parameters,
      }
   }));

   const functionCallPrompt = `
    You are an AI assistant with access to the following tools:
    Given a user question, decide which tool to use. Respond with the name of the tool and its inputs in JSON format.
    User question: "${question}"
  `;

   const messages = [{
      role: "user",
      content: functionCallPrompt
   }];

   const functionCallData = await client.chat({
      model: "llama3.2",
      messages,
      stream: false,
      tools
   });

   console.log("Function Call Data tool calls", JSON.stringify(functionCallData.message.tool_calls));

   let toolContents: any[] = [];
   let toolCalls = functionCallData.message.tool_calls;
   if (!!toolCalls) {
      try {
         var results = await Promise.all(toolCalls.map(async (toolCall) => {
            const func = toolCall.function;
            const name = func.name;
            const args = func.arguments;
            // Step 4: Execute the selected function
            const selectedFunction = functions[name];
            if (!selectedFunction)
               throw new Error(`Invalid tool selected: ${name}`);
            return await selectedFunction.implementation(args);
         }));
         console.log("Results: ", results);
         toolContents.push(...results);
      }
      catch (error) {
         console.error("Error: ", error);
         return "";
      }
   }
   else {
      await saveConversation(question, functionCallData.message.content);
      return functionCallData.message.content;
   }

   // Step 5: Build the final answer prompt
   const finalPrompt = `${question}`;

   console.log("Final Prompt:", finalPrompt);

   messages.push({
      role: "user",
      content: finalPrompt
   });

   for (let toolContent of toolContents)
      messages.push({ role: "tool", content: toolContent });

   console.log("Messages:", messages);

   // Step 6: Generate the final answer using Ollama
   const answerData = await client.chat({
      model: "llama3.2",
      messages,
      stream: false,
      options: {
         seed: 101,
         temperature: 0,
      }
   });

   // Step 6: Save the current conversation to the database
   await saveConversation(question, answerData.message.content);

   return answerData.message.content; // Assuming Ollama returns the answer in `data.text`
};

export const saveConversation = async (question: string, answer: string) => {

   const query = `
    INSERT INTO conversations (question, answer)
    VALUES ($1, $2)
    RETURNING id;
  `;

   console.log("saveConversation");

   const result = await queryDB(query, [question, answer]);

   return result[0]?.id;
};