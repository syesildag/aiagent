import "dotenv/config";
import { askQuestionWithFunctions } from './utils/aiAgent';
import { pool } from "./utils/pgClient";

const main = async () => {
   const question = process.argv[2];
   console.log("Question:", question);
   const answer = await askQuestionWithFunctions(question);
   console.log("Answer:", answer);
   pool.end();
};

main().catch((err) => console.error(err));