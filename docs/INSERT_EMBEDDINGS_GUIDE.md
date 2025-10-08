# Insert Embeddings Script

## Overview

The `insertEmbeddings.ts` script provides a robust solution for batch inserting documents with automatically generated embeddings into the `ai_agent_document` table using the repository pattern.

## Features

- ✅ **Automatic Embedding Generation**: Uses the embeddingService to generate vector embeddings for document content
- ✅ **Repository Pattern**: Uses AiAgentDocument repository for type-safe database operations
- ✅ **Document Type Management**: Automatically creates document types if they don't exist
- ✅ **Batch Processing**: Processes documents in configurable batches to avoid overwhelming services
- ✅ **Duplicate Prevention**: Checks for existing documents by name to avoid duplicates
- ✅ **Error Handling**: Continues processing even if individual documents fail
- ✅ **Multiple Providers**: Supports OpenAI, Ollama, and local embedding models
- ✅ **Comprehensive Logging**: Detailed progress and error logging

## Usage

### Programmatic Usage

```typescript
import insertEmbeddings, { DocumentInput } from '../scripts/insertEmbeddings';

const documents: DocumentInput[] = [
  {
    name: "User Guide",
    content: "Comprehensive guide for using the system...",
    type: "documentation"
  },
  {
    name: "API Reference",
    content: "Complete API documentation...", 
    type: "reference"
  }
];

const results = await insertEmbeddings(documents, {
  embeddingModel: 'text-embedding-3-small',
  embeddingProvider: 'openai',
  batchSize: 10
});
```

### CLI Usage

```bash
# Run the example script
npm run buildInsertEmbeddings

# Or run directly after build
npm run build
node dist/scripts/insertEmbeddingsExample.js
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embeddingModel` | string | `undefined` | Specific embedding model to use |
| `embeddingProvider` | string | `undefined` | Provider preference (openai, ollama, local) |
| `batchSize` | number | `10` | Number of documents to process in each batch |

## Document Input Format

```typescript
interface DocumentInput {
  name: string;     // Unique document name/identifier
  content: string;  // Text content to generate embeddings for
  type: string;     // Document type (creates AiAgentDocumentType if needed)
}
```

## Database Schema

The script interacts with these tables:

### `ai_agent_document`
- `id` - Primary key (auto-generated)
- `name` - Unique document name
- `content` - Document text content
- `type_id` - Foreign key to ai_agent_document_type
- `embedding` - JSON string containing the vector embedding
- `created_at` - Timestamp

### `ai_agent_document_type`  
- `id` - Primary key (auto-generated)
- `type` - Unique type name

## Error Handling

- **Individual Document Failures**: Script continues processing other documents
- **Missing Fields**: Skips documents with missing required fields
- **Duplicate Names**: Skips documents that already exist
- **Embedding Service Errors**: Logged and document skipped
- **Database Errors**: Logged with full error details

## Performance Considerations

- **Batch Processing**: Processes documents in configurable batches
- **Rate Limiting**: 1-second delay between batches to be gentle on services
- **Caching**: Embedding service includes LRU caching for repeated content
- **Connection Pooling**: Uses existing database connection pool

## Monitoring & Logging

The script provides comprehensive logging:

```
[INFO] Starting embedding generation and insertion for 5 documents
[INFO] Processing batch 1/2 (3 documents)
[DEBUG] Processing document: User Guide
[DEBUG] Generating embedding for: User Guide
[INFO] Successfully created document: User Guide (ID: 123)
[INFO] Embedding insertion completed. Successfully processed 5/5 documents
```

## Example Output

```
✅ Successfully inserted 5 documents

📄 Inserted Documents:
1. AI Agent Architecture Overview
   ID: 1
   Type: 1
   Content length: 234 chars
   Has embedding: Yes

2. Entity Repository Pattern Guide
   ID: 2  
   Type: 2
   Content length: 198 chars
   Has embedding: Yes
```

## Integration Points

- **Embedding Service**: `src/utils/embeddingService.ts`
- **Document Entity**: `src/entities/ai-agent-document.ts`
- **Document Type Entity**: `src/entities/ai-agent-document-type.ts`
- **Logger**: `src/utils/logger.ts`
- **Config**: `src/utils/config.ts`

## Future Enhancements

- Support for document metadata fields
- Similarity search functionality
- Document update/re-embedding capabilities
- Progress bars for large batches
- Export/import functionality for document collections