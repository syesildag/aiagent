import client from "./ollama";

export const getEmbeddings = async (text: string): Promise<number[]> => {
   const response = await client.embed({ model: "nomic-embed-text", input: text });
   return response.embeddings[0]; // Assuming Ollama returns embeddings in `data.embedding`
};