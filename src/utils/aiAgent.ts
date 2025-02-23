import { Message } from 'ollama';
import { functions, tools } from './aiFunctionsAndTools';
import client from './ollama';
import { queryDatabase } from './pgClient';

export const askQuestionWithFunctions = async (session: string, agentName: string, question: string): Promise<string> => {

   const systemPrompt = `
Cutting Knowledge Date: December 2023
Today Date: 23 July 2024

When you receive a tool call response, use the output to format an answer to the orginal user question.

You are a helpful assistant with tool calling capabilities.
  `;

   const userPrompt = `Question: ${question}`;

   let messages: Message[] = [{
      role: "system",
      content: systemPrompt
   }, {
      role: "user",
      content: userPrompt
   }];

   let functionCallData = await client.chat({
      model: String(process.env.OLLAMA_MODEL),
      messages,
      stream: false,
      tools
   });

   if (functionCallData.message.tool_calls?.some((toolCall: any) => toolCall.function.name === "fetchSQL")) {
      messages = [{
            role: "system",
            content: systemPrompt
         }, {
            role: "assistant",
            content: `SQL SCHEMA ->
   CREATE TABLE IF NOT EXISTS public.country
   (
      id integer NOT NULL DEFAULT nextval('country_id_seq'::regclass),
      iso character(2) COLLATE pg_catalog."default" NOT NULL,
      name character varying(80) COLLATE pg_catalog."default" NOT NULL,
      nicename character varying(80) COLLATE pg_catalog."default" NOT NULL,
      iso3 character(3) COLLATE pg_catalog."default" DEFAULT NULL::bpchar,
      numcode smallint,
      phonecode integer NOT NULL,
      CONSTRAINT country_pkey PRIMARY KEY (id)
   );`
         }, {
            role: "user",
            content: userPrompt
         },
      ];
      functionCallData = await client.chat({
         model: String(process.env.OLLAMA_MODEL),
         messages,
         stream: false,
         tools
      });
   }

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
      await saveConversation(question, functionCallData.message.content);
      return functionCallData.message.content;
   }

   for (let toolContent of toolContents)
      messages.push({ role: "tool", content: toolContent });

   messages.push({
      role: "user",
      content: userPrompt
   });

   const answerData = await client.chat({
      model: String(process.env.OLLAMA_MODEL),
      messages,
      stream: false,
      options: {
         seed: 101,
         temperature: 0,
      }
   });

   const finalAnswer = answerData.message.content;

   await saveConversation(question, finalAnswer);

   return finalAnswer;
};

export const saveConversation = async (question: string, answer: string) => {

   const query = `
    INSERT INTO conversations (question, answer)
    VALUES ($1, $2)
    RETURNING id;
  `;

   const result = await queryDatabase(query, [question, answer]);

   return result[0]?.id;
};