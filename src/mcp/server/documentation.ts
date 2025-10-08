#!/usr/bin/env node

/**
 * MCP Documentation Server - A read-only implementation for document access
 * 
 * This server provides read-only access to documents stored in ai_agent_document:
 * - Using McpServer for modern MCP implementation
 * - Zod schema validation for type safety
 * - Resource templates with URI patterns for document types
 * - PostgreSQL persistence with repository pattern
 * - Semantic search using embeddings
 * - Read-only operations (no document creation/modification)
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import aiagentdocumenttypeRepository from "../../entities/ai-agent-document-type.js";
import aiagentdocumentRepository, { AiAgentDocument } from "../../entities/ai-agent-document.js";
import { getEmbeddings } from "../../utils/embeddingService.js";
import Logger from "../../utils/logger.js";
import { closeDatabase, queryDatabase } from "../../utils/pgClient.js";

/**
 * Input schemas for tools (read-only operations only)
 */
const SearchDocumentInputSchema = {
  query: z.string().min(1, "Search query cannot be empty"),
  type: z.string().optional().describe("Filter by document type"),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return")
};

const ListDocumentInputSchema = {
  type: z.string().optional().describe("Filter by document type"),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return")
};

const GetDocumentInputSchema = {
  id: z.number().int().positive().describe("Document ID to retrieve")
};

/**
 * Create a modern MCP server using the high-level McpServer API
 */
const server = new McpServer({
  name: "documentation-server",
  version: "1.0.0"
});

/**
 * Register document types resource - lists all available document types
 */
server.registerResource(
  "document-types",
  "docs://types",
  {
    title: "Document Types",
    description: "List all available document types in the system",
    mimeType: "application/json"
  },
  async () => {
    try {
      const types = await aiagentdocumenttypeRepository.findAll({
        orderBy: [{ field: 'type', direction: 'ASC' }]
      });

      const typeList = types.map(type => ({
        id: type.getId(),
        type: type.getType()
      }));

      return {
        contents: [{
          uri: "docs://types",
          mimeType: "application/json",
          text: JSON.stringify(typeList, null, 2)
        }]
      };
    } catch (error) {
      Logger.error("Failed to fetch document types:", error);
      throw error;
    }
  }
);

/**
 * Register document statistics resource
 */
server.registerResource(
  "document-stats",
  "docs://stats",
  {
    title: "Document Statistics",
    description: "Get statistics about documents in the system",
    mimeType: "application/json"
  },
  async () => {
    try {
      const result = await queryDatabase(`
        SELECT 
          adt.type,
          COUNT(ad.id) as document_count,
          AVG(LENGTH(ad.content)) as avg_content_length,
          MAX(ad.created_at) as latest_document
        FROM ai_agent_document_type adt
        LEFT JOIN ai_agent_document ad ON adt.id = ad.type_id
        GROUP BY adt.id, adt.type
        ORDER BY adt.type
      `);

      const stats = {
        total_documents: result.reduce((sum: number, row: any) => sum + parseInt(row.document_count), 0),
        types: result.map((row: any) => ({
          type: row.type,
          document_count: parseInt(row.document_count),
          avg_content_length: row.avg_content_length ? Math.round(row.avg_content_length) : 0,
          latest_document: row.latest_document
        }))
      };

      return {
        contents: [{
          uri: "docs://stats",
          mimeType: "application/json",
          text: JSON.stringify(stats, null, 2)
        }]
      };
    } catch (error) {
      Logger.error("Failed to fetch document statistics:", error);
      throw error;
    }
  }
);

/**
 * Register dynamic document resource for documents by type
 */
server.registerResource(
  "documents-by-type",
  new ResourceTemplate("docs://type/{type}", {
    list: async () => {
      try {
        const result = await queryDatabase(`
          SELECT 
            adt.type,
            COUNT(ad.id) as count 
          FROM ai_agent_document_type adt
          LEFT JOIN ai_agent_document ad ON adt.id = ad.type_id
          GROUP BY adt.id, adt.type 
          ORDER BY adt.type
        `);

        return {
          resources: result.map((row: any) => ({
            uri: `docs://type/${row.type}`,
            name: `${row.type} documents`,
            description: `${row.count} documents of type: ${row.type}`,
            mimeType: "application/json"
          }))
        };
      } catch (error) {
        Logger.error("Failed to list document type resources:", error);
        return { resources: [] };
      }
    }
  }),
  {
    title: "Documents by Type",
    description: "Documents filtered by document type"
  },
  async (uri, { type }) => {
    try {
      const docType = Array.isArray(type) ? type[0] : type;
      
      // Find the document type first
      const documentType = await aiagentdocumenttypeRepository.findByType(docType);
      if (!documentType) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify([], null, 2)
          }]
        };
      }

      // Find documents by type ID using repository pattern with relationships
      const documents = await aiagentdocumentRepository.findAll({
        where: { typeId: documentType.getId() },
        orderBy: [{ field: 'createdAt', direction: 'DESC' }]
      });

      // Convert entities to plain objects for JSON serialization
      const result = documents.map(doc => ({
        id: doc.getId(),
        name: doc.getName(),
        content: doc.getContent(),
        type_id: doc.getTypeId(),
        created_at: doc.getCreatedAt(),
        content_preview: doc.getContent().substring(0, 200) + (doc.getContent().length > 200 ? '...' : '')
      }));

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      Logger.error(`Failed to fetch documents for type ${type}:`, error);
      throw error;
    }
  }
);

/**
 * Register individual document resource
 */
server.registerResource(
  "document",
  new ResourceTemplate("docs://document/{id}", {
    list: async () => {
      try {
        const documents = await aiagentdocumentRepository.findAll({
          orderBy: [{ field: 'createdAt', direction: 'DESC' }],
          limit: 50
        });

        return {
          resources: documents.map(doc => ({
            uri: `docs://document/${doc.getId()}`,
            name: doc.getName(),
            description: `Document: ${doc.getName()} (${doc.getContent().length} chars)`,
            mimeType: "text/plain"
          }))
        };
      } catch (error) {
        Logger.error("Failed to list document resources:", error);
        return { resources: [] };
      }
    }
  }),
  {
    title: "Individual Document",
    description: "Access individual document content"
  },
  async (uri, { id }) => {
    try {
      const docId = Array.isArray(id) ? parseInt(id[0]) : parseInt(id);
      
      const document = await aiagentdocumentRepository.getById(docId);
      if (!document) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/plain",
            text: `Document with ID ${docId} not found`
          }]
        };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: document.getContent()
        }]
      };
    } catch (error) {
      Logger.error(`Failed to fetch document with ID ${id}:`, error);
      throw error;
    }
  }
);

/**
 * Tool to search documents using semantic similarity
 */
server.registerTool(
  "document_search",
  {
    title: "Search Documents",
    description: "Search documents using semantic similarity with optional type filter",
    inputSchema: SearchDocumentInputSchema
  },
  async ({ query, type, limit = 10 }) => {
    try {
      // Generate embedding for search query
      const queryEmbedding = await getEmbeddings(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw new Error("Failed to generate embedding for search query");
      }

      // Complex vector similarity search with document type join
      let sqlQuery = `
        SELECT 
          ad.id,
          ad.name,
          ad.content,
          ad.type_id,
          ad.created_at,
          adt.type as document_type,
          ad.embedding <=> $1::vector as cosine_distance
        FROM ai_agent_document ad
        JOIN ai_agent_document_type adt ON ad.type_id = adt.id
        WHERE 1=1
      `;

      const queryParams: any[] = [`[${queryEmbedding.join(',')}]`];
      let paramCount = 1;

      if (type) {
        paramCount++;
        sqlQuery += ` AND adt.type = $${paramCount}`;
        queryParams.push(type);
      }

      sqlQuery += `
        ORDER BY cosine_distance ASC
        LIMIT $${paramCount + 1}
      `;
      queryParams.push(limit);

      const result = await queryDatabase(sqlQuery, queryParams);

      Logger.info(`Found ${result.length} documents for query: "${query}"`);

      if (result.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No documents found for query: "${query}"`
          }]
        };
      }

      // Format results with similarity scores and content previews
      const formattedResults = result.map((row: any) => ({
        id: row.id,
        name: row.name,
        document_type: row.document_type,
        similarity: Math.round((1 - row.cosine_distance) * 100) / 100,
        content_preview: row.content.substring(0, 300) + (row.content.length > 300 ? '...' : ''),
        created_at: row.created_at
      }));

      return {
        content: [
          {
            type: "text",
            text: `Found ${result.length} documents (showing top ${limit}):`
          },
          {
            type: "text",
            text: JSON.stringify(formattedResults, null, 2)
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to search documents:", error);
      return {
        content: [{
          type: "text",
          text: `Failed to search documents: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to list all documents with optional type filter
 */
server.registerTool(
  "document_list",
  {
    title: "List Documents",
    description: "List all documents with optional type filter",
    inputSchema: ListDocumentInputSchema
  },
  async ({ type, limit = 50 }) => {
    try {
      let documents: AiAgentDocument[] = [];

      if (type) {
        // Find documents by type
        const documentType = await aiagentdocumenttypeRepository.findByType(type);
        if (!documentType) {
          return {
            content: [{
              type: "text",
              text: `Document type "${type}" not found`
            }]
          };
        }

        documents = await aiagentdocumentRepository.findAll({
          where: { typeId: documentType.getId() },
          orderBy: [{ field: 'createdAt', direction: 'DESC' }],
          limit: limit
        });
      } else {
        // List all documents
        documents = await aiagentdocumentRepository.findAll({
          orderBy: [{ field: 'createdAt', direction: 'DESC' }],
          limit: limit
        });
      }

      Logger.info(`Listed ${documents.length} documents${type ? ` of type "${type}"` : ''}`);

      if (documents.length === 0) {
        return {
          content: [{
            type: "text",
            text: type ? `No documents found of type "${type}"` : "No documents found"
          }]
        };
      }

      // Convert entities to plain objects with content previews
      const result = documents.map(doc => ({
        id: doc.getId(),
        name: doc.getName(),
        type_id: doc.getTypeId(),
        content_preview: doc.getContent().substring(0, 200) + (doc.getContent().length > 200 ? '...' : ''),
        content_length: doc.getContent().length,
        created_at: doc.getCreatedAt()
      }));

      return {
        content: [
          {
            type: "text",
            text: `Found ${result.length} documents${type ? ` of type "${type}"` : ''}:`
          },
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to list documents:", error);
      return {
        content: [{
          type: "text",
          text: `Failed to list documents: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to get a specific document by ID
 */
server.registerTool(
  "document_get",
  {
    title: "Get Document",
    description: "Retrieve a specific document by its ID",
    inputSchema: GetDocumentInputSchema
  },
  async ({ id }) => {
    try {
      const document = await aiagentdocumentRepository.getById(id);

      if (!document) {
        return {
          content: [{
            type: "text",
            text: `Document with ID ${id} not found`
          }],
          isError: true
        };
      }

      // Get document type information
      const documentType = await aiagentdocumenttypeRepository.getById(document.getTypeId());
      
      const result = {
        id: document.getId(),
        name: document.getName(),
        content: document.getContent(),
        type: documentType?.getType() || 'unknown',
        type_id: document.getTypeId(),
        created_at: document.getCreatedAt(),
        content_length: document.getContent().length
      };

      Logger.info(`Retrieved document: ${document.getName()} (ID: ${id})`);

      return {
        content: [
          {
            type: "text",
            text: `Document: ${document.getName()}`
          },
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to get document:", error);
      return {
        content: [{
          type: "text",
          text: `Failed to get document: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to get document content only (for easy reading)
 */
server.registerTool(
  "document_read",
  {
    title: "Read Document Content",
    description: "Get the full content of a document by ID for reading",
    inputSchema: GetDocumentInputSchema
  },
  async ({ id }) => {
    try {
      const document = await aiagentdocumentRepository.getById(id);

      if (!document) {
        return {
          content: [{
            type: "text",
            text: `Document with ID ${id} not found`
          }],
          isError: true
        };
      }

      Logger.info(`Reading document content: ${document.getName()} (ID: ${id})`);

      return {
        content: [{
          type: "text",
          text: `# ${document.getName()}\n\n${document.getContent()}`
        }]
      };
    } catch (error) {
      Logger.error("Failed to read document:", error);
      return {
        content: [{
          type: "text",
          text: `Failed to read document: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Start the server
 */
async function main(): Promise<void> {
  try {
    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    Logger.info("Documentation MCP Server started successfully");
  } catch (error) {
    Logger.error("Failed to start Documentation server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
async function shutdown(): Promise<void> {
  try {
    Logger.info("Shutting down Documentation MCP Server...");
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    Logger.error("Error during shutdown:", error);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  Logger.error("Unhandled server error:", error);
  process.exit(1);
});