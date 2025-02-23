
import { z } from "zod";
import { Description } from "../utils/makeTool";
import { queryDatabase } from "../utils/pgClient";

const Query = z.object({
   query: z.string().describe("Search query to be executed"),
});

const fetchConversations: Description<typeof Query> = {
   name: "fetchConversations",
   description: "Fetch conversations from database",
   parameters: Query,
   implementation: async ({ query }) => {
      const sqlQuery = `
            SELECT question
            FROM conversations
            ORDER BY timestamp DESC LIMIT 10;
         `;
      const results = await queryDatabase(sqlQuery);
      return "Previous Conversations:\n" + results
         .map((row: any) => `-> ${row.question}`)
         .join('\n');
   }
};

export default fetchConversations;