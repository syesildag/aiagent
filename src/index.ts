import "dotenv/config";
import { askQuestionWithFunctions } from './utils/aiAgent';

const main = async () => {
   const question = process.argv[2];
   console.log("Question:", question);
   const answer = await askQuestionWithFunctions(question);
   console.log("Answer:", answer);
};

main().catch((err) => console.error(err));