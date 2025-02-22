
import { z } from "zod";
import { Description } from "../utils/makeTool";
import { queryDB } from "../utils/pgClient";
import { getEmbeddings } from "../utils/embeddingHelper";

const Query = z.object({
   query: z.string().describe("Search query to be executed"),
});

const fetchDocuments: Description<typeof Query> = {
   name: "fetchDocuments",
   description: "Fetch documents from database",
   parameters: Query,
   implementation: async ({ query }) => {
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
   }
};

export default fetchDocuments;