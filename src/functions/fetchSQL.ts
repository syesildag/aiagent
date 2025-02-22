
import { z } from "zod";
import { Description } from "../utils/makeTool";
import { queryDB } from "../utils/pgClient";

const Query = z.object({
   query: z.string().describe("SQL query to be executed"),
});

const fetchSQL: Description<typeof Query> = {
   name: "fetchSQL",
   description: "Fetch data from database using SQL query.",
   parameters: Query,
   implementation: async ({ query }) => {
      const results = await queryDB(query.replaceAll('"', '\''));
      return "SQL result:\n" + JSON.stringify(results);
   }
};

export default fetchSQL;