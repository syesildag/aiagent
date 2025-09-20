import { OllamaProvider } from "../mcp/llmProviders";
import { config } from "./config";

export const getEmbeddings = async (text: string): Promise<number[]> => {
   // For embeddings, we always use Ollama since it supports the embed method
   const ollamaProvider = new OllamaProvider(config.OLLAMA_HOST);
   
   // Access the underlying Ollama client for embeddings
   const ollama = (ollamaProvider as any).ollama;
   if (!ollama) {
      throw new Error('Ollama client not available for embeddings');
   }
   
   const response = await ollama.embed({ model: "nomic-embed-text", input: text });
   return response.embeddings[0]; // Assuming Ollama returns embeddings in `data.embedding`
};