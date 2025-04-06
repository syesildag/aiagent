
import { z } from "zod";
import { Description } from "../utils/makeTool";
import { queryDatabase } from "../utils/pgClient";
import Logger from "../utils/logger";

const Query = z.object({
   query: z.string().describe("SQL query to be executed"),
});

const fetchSQL: Description<typeof Query> = {
   name: "fetchSQL",
   description: "Fetch data from database using SQL query.",
   parameters: Query,
   implementation: async ({ query }) => {
      Logger.info("SQL query: " + query);
      const results = await queryDatabase(query.replaceAll('"', '\''));
      Logger.info("Executing formatted SQL query: " + query);
      return "SQL result:\n" + JSON.stringify(results);
   }
};

export default fetchSQL;