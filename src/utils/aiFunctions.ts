import { queryDB } from './pgClient';
import { getEmbeddings } from './embeddingHelper';
import { z } from 'zod';
import { zodToJsonSchema } from "zod-to-json-schema";

interface FunctionDefinition {
   name: string;
   description: string;
   parameters: any;
   implementation: (...args: any[]) => Promise<any>;
}

const Query = z.object({
   query: z.string(),
});

type Query = z.infer<typeof Query>;

const WeatherParams = z.object({
   location: z.string().describe("Location for which weather information is needed"),
   units: z.enum(["celcius", "fahrenheit"]).optional().describe("Units for temperature. Default is celcius"),
});

type WeatherParams = z.infer<typeof WeatherParams>;

export const functions: { [fnName: string]: FunctionDefinition } = {
   fetchRelevantDocuments: {
      name: "fetchRelevantDocuments",
      description: "Fetch relevant documents from the database using vector similarity search.",
      parameters: zodToJsonSchema(Query, "schema").definitions?.schema,
      implementation: async ({query}: Query) => {
         const embedding = await getEmbeddings(query);
         const sqlQuery = `
         SELECT * FROM (
            SELECT content, embedding <-> $1 AS score
            FROM documents
         ) T WHERE score < 1 ORDER BY score LIMIT 5;
         `;
         console.log("Executing function: fetchRelevantDocuments");
         console.log("Executing query: ", sqlQuery);
         const results = await queryDB(sqlQuery, [JSON.stringify(embedding)]);
         console.log("fetchRelevantDocuments results: ", results);
         return "Relevant documents:\n" + results
         .map((row: any) => `-> ${row.content}`).join('\n');
      },
   },

   fetchConversationHistory: {
      name: "fetchConversationHistory",
      description: "Retrieve relevant conversations from question.",
      parameters: zodToJsonSchema(Query, "schema").definitions?.schema,
      implementation: async ({ query }: Query) => {

         const sqlQuery = `
            SELECT question
            FROM conversations
            ORDER BY timestamp DESC LIMIT 10;
         `;

         const results = await queryDB(sqlQuery);
         return "Previous Conversations:\n" + results
            .map((row: any) => `-> ${row.question}`)
            .join('\n');
      },
   },
   fetchSQL: {
      name: "fetchSQL",
      description: "Retrieve relevant data using SQL from database.",
      parameters: zodToJsonSchema(Query, "schema").definitions?.schema,
      implementation: async ({ query }: Query) => {
         const results = await queryDB(query);
         return "SQL result:\n" + JSON.stringify(results);
      },
   },
   fetchCurrentWeatherInformation: {
      name: "fetchCurrentWeatherInformation",
      description: "fetch Current Weather Information",
      parameters: zodToJsonSchema(WeatherParams, "schema").definitions?.schema,
      implementation: async ({ location, units }: WeatherParams) => {
         const apiKey = process.env.OPENWEATHER_API_KEY;
         const url = `https://api.openweathermap.org/data/2.5/weather?q=${location}&appid=${apiKey}&units=metric`;
         const response = await fetch(url);
         return "Units in metric: " + JSON.stringify(await response.json());
      },
   }
};