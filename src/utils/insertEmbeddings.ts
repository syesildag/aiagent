import { closeDatabase, queryDatabase } from './pgClient';
import { getEmbeddings } from './embeddingHelper';

const insertDocuments = async () => {
   const documents = [
      "Artificial Intelligence is a branch of computer science.",
      "Machine learning is a subset of artificial intelligence.",
      "Deep learning is a subset of machine learning.",
      "Resalys is a french company that specializes in Hospitality.",
      "The temperature at Paris is 12 degrees celsius.",
      "My name is Serkan.",
      "Stock: Apple: 5 units",
      "Stock: Banana: 5 units",
      "Stock: Orange: 2 units",
      "Stock: Tomatoes: 0 units",
   ];

   for (const content of documents) {
      const embedding = await getEmbeddings(content);
      await queryDatabase(
         `INSERT INTO documents (content, embedding) VALUES ($1, $2)`,
         [content, JSON.stringify(embedding)]
      );
   }

   closeDatabase();
};

insertDocuments().catch((err) => console.error(err));