import aiagentdocumentRepository, { AiAgentDocument } from '../entities/ai-agent-document';
import aiagentdocumenttypeRepository, { AiAgentDocumentType } from '../entities/ai-agent-document-type';
import { getEmbeddingService, EmbeddingProviderType } from '../utils/embeddingService';
import Logger from '../utils/logger';

export interface DocumentInput {
  name: string;
  content: string;
  type: string;
}

/**
 * Insert embeddings for a list of documents
 * 
 * This script:
 * 1. Takes a list of documents with name, content, and type
 * 2. Generates embeddings for each document using embeddingService
 * 3. Ensures document type exists (creates if needed)
 * 4. Inserts documents into ai_agent_document table using repository pattern
 * 
 * @param documents - Array of documents to process
 * @param options - Optional configuration for embedding generation
 * @returns Promise<AiAgentDocument[]> - Array of created document entities
 */
export async function insertEmbeddings(
  documents: DocumentInput[],
  options?: {
    embeddingModel?: string;
    embeddingProvider?: Exclude<EmbeddingProviderType, 'auto'>;
    batchSize?: number;
  }
): Promise<AiAgentDocument[]> {
  const embeddingService = getEmbeddingService();
  const batchSize = options?.batchSize || 10;
  const createdDocuments: AiAgentDocument[] = [];

  Logger.info(`Starting embedding generation and insertion for ${documents.length} documents`);

  try {
    // Process documents in batches to avoid overwhelming the embedding service
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      Logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)} (${batch.length} documents)`);

      // Process each document in the current batch
      for (const doc of batch) {
        try {
          Logger.debug(`Processing document: ${doc.name}`);

          // 1. Validate document input
          if (!doc.name || !doc.content || !doc.type) {
            Logger.warn(`Skipping document with missing required fields: ${JSON.stringify(doc)}`);
            continue;
          }

          // 2. Ensure document type exists
          let documentType = await aiagentdocumenttypeRepository.findByType(doc.type);
          if (!documentType) {
            Logger.info(`Creating new document type: ${doc.type}`);
            documentType = new AiAgentDocumentType({
              type: doc.type
            });
            documentType = await aiagentdocumenttypeRepository.save(documentType);
          }

          // 3. Check if document already exists
          const existingDoc = await aiagentdocumentRepository.findByName(doc.name);
          if (existingDoc) {
            Logger.warn(`Document with name '${doc.name}' already exists, skipping`);
            continue;
          }

          // 4. Generate embedding for the document content
          Logger.debug(`Generating embedding for: ${doc.name}`);
          const embedding = await embeddingService.generateEmbedding(doc.content, {
            model: options?.embeddingModel,
            provider: options?.embeddingProvider
          });

          // 5. Create and save the document with embedding
          const aiDocument = new AiAgentDocument({
            name: doc.name,
            content: doc.content,
            typeId: documentType.getId()!,
            embedding: JSON.stringify(embedding), // Store as JSON string
            createdAt: new Date()
          });

          const savedDocument = await aiagentdocumentRepository.save(aiDocument);
          createdDocuments.push(savedDocument);
          
          Logger.info(`Successfully created document: ${doc.name} (ID: ${savedDocument.getId()})`);

        } catch (error) {
          Logger.error(`Failed to process document '${doc.name}': ${error instanceof Error ? error.message : String(error)}`);
          // Continue processing other documents even if one fails
        }
      }

      // Add a small delay between batches to be gentle on the embedding service
      if (i + batchSize < documents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    Logger.info(`Embedding insertion completed. Successfully processed ${createdDocuments.length}/${documents.length} documents`);
    return createdDocuments;

  } catch (error) {
    Logger.error('Failed to insert embeddings:', error);
    throw error;
  }
}

export default insertEmbeddings;