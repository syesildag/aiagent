#!/usr/bin/env node

/**
 * MCP Memory Server - A modern implementation using the high-level McpServer API
 * 
 * This server demonstrates MCP best practices:
 * - Using McpServer instead of low-level Server for better developer experience
 * - Zod schema validation for type safety and runtime validation
 * - Proper resource templates with URI patterns
 * - PostgreSQL persistence with proper connection handling
 * - Semantic search using embeddings
 * - Modern TypeScript patterns
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { queryDatabase, closeDatabase } from "../../utils/pgClient.js";
import { getEmbeddings } from "../../utils/embeddingService.js";
import Logger from "../../utils/logger.js";
import { AiAgentMemories } from "../../entities/ai-agent-memories.js";
import aiagentmemoriesRepository from "../../entities/ai-agent-memories.js";

/**
 * Zod schemas for memory validation
 */
const MemorySchema = z.object({
  type: z.string().min(1, "Memory type cannot be empty"),
  content: z.record(z.any()).or(z.string()).describe("Memory content (object or string)"),
  source: z.string().min(1, "Source cannot be empty"),
  tags: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0 and 1")
});

// Input schemas for tools (using object shape, not Zod objects directly)
const CreateMemoryInputSchema = z.object({
  type: z.string().min(1, "Memory type cannot be empty"),
  content: z.record(z.any()).or(z.string()).describe("Memory content (object or string)"),
  source: z.string().min(1, "Source cannot be empty"),
  tags: z.array(z.string()).optional().describe("Optional tags for the memory"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0 and 1"),
  user_login: z.string().optional().describe("User login to scope this memory to a specific user")
});

const SearchMemoryInputSchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
  type: z.string().optional().describe("Filter by memory type"),
  tags: z.array(z.string()).optional().describe("Filter by tags"),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return"),
  user_login: z.string().optional().describe("Restrict search to memories of this user")
});

const ListMemoryInputSchema = z.object({
  type: z.string().optional().describe("Filter by memory type"),
  tags: z.array(z.string()).optional().describe("Filter by tags"),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return"),
  user_login: z.string().optional().describe("Restrict listing to memories of this user")
});

type Memory = z.infer<typeof MemorySchema>;

/**
 * Create a modern MCP server using the high-level McpServer API
 */
const server = new McpServer({
  name: "memory-server",
  version: "1.0.0"
});

/**
 * Helper function to prepare content for embedding generation
 */
function prepareContentForEmbedding(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  return JSON.stringify(content);
}

/**
 * Register memory resources - lists memory types and tags
 */
server.registerResource(
  "memory-types",
  "memory://types",
  {
    title: "Memory Types",
    description: "List all available memory types in the system",
    mimeType: "application/json"
  },
  async () => {
    try {
      const result = await queryDatabase("SELECT DISTINCT type FROM ai_agent_memories ORDER BY type");
      const types = result.map((row: any) => row.type);

      return {
        contents: [{
          uri: "memory://types",
          mimeType: "application/json",
          text: JSON.stringify(types, null, 2)
        }]
      };
    } catch (error) {
      Logger.error("Failed to fetch memory types:", error);
      throw error;
    }
  }
);

server.registerResource(
  "memory-tags",
  "memory://tags",
  {
    title: "Memory Tags",
    description: "List all available tags used in memories",
    mimeType: "application/json"
  },
  async () => {
    try {
      const result = await queryDatabase("SELECT DISTINCT unnest(tags) as tag FROM ai_agent_memories ORDER BY tag");
      const tags = result.map((row: any) => row.tag);

      return {
        contents: [{
          uri: "memory://tags",
          mimeType: "application/json",
          text: JSON.stringify(tags, null, 2)
        }]
      };
    } catch (error) {
      Logger.error("Failed to fetch memory tags:", error);
      throw error;
    }
  }
);

/**
 * Register dynamic memory resource for individual memories
 */
server.registerResource(
  "memory",
  new ResourceTemplate("memory:///{type}", {
    list: async () => {
      try {
        const result = await queryDatabase(`
          SELECT DISTINCT type, COUNT(*) as count 
          FROM ai_agent_memories 
          GROUP BY type 
          ORDER BY type
        `);

        return {
          resources: result.map((row: any) => ({
            uri: `memory:///${row.type}`,
            name: `${row.type} memories`,
            description: `${row.count} memories of type: ${row.type}`,
            mimeType: "application/json"
          }))
        };
      } catch (error) {
        Logger.error("Failed to list memory resources:", error);
        return { resources: [] };
      }
    }
  }),
  {
    title: "Memory by Type",
    description: "Memories filtered by type"
  },
  async (uri, { type }) => {
    try {
      const memoryType = Array.isArray(type) ? type[0] : type;
      // Using repository pattern with ordering support
      const memories = await aiagentmemoriesRepository.findByTypeOrderByCreatedAtDesc(memoryType);
      
      if (!memories) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify([], null, 2)
          }]
        };
      }

      // Convert entities to plain objects for JSON serialization
      const result = memories.map(memory => ({
        id: memory.getId(),
        type: memory.getType(),
        content: memory.getContent(),
        source: memory.getSource(),
        tags: memory.getTags(),
        confidence: memory.getConfidence(),
        created_at: memory.getCreatedAt(),
        updated_at: memory.getUpdatedAt()
      }));

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      Logger.error(`Failed to fetch memories for type ${type}:`, error);
      throw error;
    }
  }
);

/**
 * Tool to create a new memory with semantic embeddings
 */
server.registerTool(
  "memory_create",
  {
    title: "Create Memory",
    description: "Create a new memory entry with semantic embedding",
    inputSchema: CreateMemoryInputSchema
  },
  async ({ type, content, source, tags = [], confidence, user_login }) => {
    try {
      // Validate input
      const validatedData = MemorySchema.parse({ type, content, source, tags, confidence });

      // Ensure content is proper JSON object for database storage
      let contentForStorage = validatedData.content;
      if (typeof contentForStorage === 'string') {
        contentForStorage = { text: contentForStorage };
      }

      // Generate embedding for semantic search
      const textForEmbedding = prepareContentForEmbedding(validatedData.content);
      const embedding = await getEmbeddings(textForEmbedding);

      if (!embedding || embedding.length === 0) {
        throw new Error("Failed to generate embedding for content");
      }

      // Create memory using repository pattern
      const memory = new AiAgentMemories({
        type: validatedData.type,
        content: contentForStorage,
        source: validatedData.source,
        embedding: `[${embedding.join(',')}]`,
        tags: validatedData.tags,
        confidence: validatedData.confidence,
        userLogin: user_login,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      await memory.save();
      const createdMemory = { id: memory.getId(), type: memory.getType() };
      Logger.info(`Memory created successfully with ID: ${createdMemory.id}`);

      // Optional: Clean up near-duplicate embeddings
      queryDatabase(`
        DELETE FROM ai_agent_memories WHERE id IN (
        SELECT m1.id
          FROM ai_agent_memories AS m1
         INNER JOIN ai_agent_memories AS m2
            ON m1.id <> m2.id
           AND m1.id < m2.id
         WHERE (1 - (m1.embedding <=> m2.embedding)) > 0.9
      )`);

      return {
        content: [{
          type: "text",
          text: `Successfully created memory with ID ${createdMemory.id} of type "${validatedData.type}"`
        }]
      };
    } catch (error) {
      Logger.error("Failed to create memory:", error);
      return {
        content: [{
          type: "text",
          text: `Failed to create memory: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to search memories using semantic similarity
 */
server.registerTool(
  "memory_search",
  {
    title: "Search Memories",
    description: "Search memories using semantic similarity with optional filters",
    inputSchema: SearchMemoryInputSchema
  },
  async ({ query, type, tags, limit = 10, user_login }) => {
    try {
      // Generate embedding for search query
      const queryEmbedding = await getEmbeddings(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw new Error("Failed to generate embedding for search query");
      }

      // Complex vector similarity search requires direct SQL for now
      // Repository pattern doesn't support vector operations yet
      let sqlQuery = `
        SELECT *, 1 - (embedding <=> $1::vector) as similarity
          FROM ai_agent_memories
         WHERE 1=1
      `;

      const queryParams: any[] = [`[${queryEmbedding.join(',')}]`];
      let paramCount = 1;

      if (user_login) {
        paramCount++;
        sqlQuery += ` AND (user_login = $${paramCount} OR user_login IS NULL)`;
        queryParams.push(user_login);
      }

      if (tags && tags.length > 0) {
        paramCount++;
        sqlQuery += ` AND tags && $${paramCount}::text[]`;
        queryParams.push(tags);
      }

      sqlQuery += `
        ORDER BY similarity DESC
        LIMIT $${paramCount + 1}
      `;
      queryParams.push(limit);

      const result = await queryDatabase(sqlQuery, queryParams);

      Logger.info(`Found ${result.length} memories for query: "${query}"`);

      if (result.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No memories found for query: "${query}"`
          }]
        };
      }

      // Format results with similarity scores
      const formattedResults = result.map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        source: row.source,
        tags: row.tags,
        confidence: row.confidence,
        similarity: Math.round(row.similarity * 100) / 100,
        created_at: row.created_at
      }));

      return {
        content: [
          {
            type: "text",
            text: `Found ${result.length} memories (showing top ${limit}):`
          },
          {
            type: "text",
            text: JSON.stringify(formattedResults, null, 2)
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to search memories:", error);
      return {
        content: [{
          type: "text",
          text: `Failed to search memories: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to list all memories with optional filters
 */
server.registerTool(
  "memory_list",
  {
    title: "List Memories",
    description: "List all memories with optional type and tag filters",
    inputSchema: ListMemoryInputSchema
  },
  async ({ type, tags, limit = 50, user_login }) => {
    try {
      let memories: AiAgentMemories[] | null = null;

      if (type && !tags && !user_login) {
        // Simple type filter - use repository pattern
        memories = await aiagentmemoriesRepository.findByTypeOrderByCreatedAtDesc(type);
        if (memories && limit < memories.length) {
          memories = memories.slice(0, limit);
        }
      } else if (user_login && type && !tags) {
        // User + type filter - use repository pattern
        memories = await aiagentmemoriesRepository.findByUserLoginAndTypeOrderByCreatedAtDesc(user_login, type);
        if (memories && limit < memories.length) {
          memories = memories.slice(0, limit);
        }
      } else if (user_login && !type && !tags) {
        // User-only filter - use repository pattern
        memories = await aiagentmemoriesRepository.findByUserLoginOrderByCreatedAtDesc(user_login);
        if (memories && limit < memories.length) {
          memories = memories.slice(0, limit);
        }
      } else if (!type && !tags && !user_login) {
        // No filters - use repository pattern with options
        memories = await aiagentmemoriesRepository.findAll({ 
          orderBy: [{ field: 'createdAt', direction: 'DESC' }],
          limit: limit 
        });
      } else {
        // Complex filtering with tags - still use direct SQL for array operations
        let sqlQuery = `
          SELECT id, type, content, source, tags, confidence, created_at
            FROM ai_agent_memories
           WHERE TRUE
        `;

        const queryParams: any[] = [];
        let paramCount = 0;

        if (type) {
          paramCount++;
          sqlQuery += ` AND type = $${paramCount}`;
          queryParams.push(type);
        }

        if (user_login) {
          paramCount++;
          sqlQuery += ` AND (user_login = $${paramCount} OR user_login IS NULL)`;
          queryParams.push(user_login);
        }

        if (tags && tags.length > 0) {
          paramCount++;
          sqlQuery += ` AND tags && $${paramCount}::text[]`;
          queryParams.push(tags);
        }

        sqlQuery += `
          ORDER BY created_at DESC
          LIMIT $${paramCount + 1}
        `;
        queryParams.push(limit);

        const result = await queryDatabase(sqlQuery, queryParams);
        
        Logger.info(`Listed ${result.length} memories with complex filters`);

        if (result.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No memories found with the specified filters"
            }]
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Found ${result.length} memories:`
            },
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      Logger.info(`Listed ${memories?.length || 0} memories using repository pattern`);

      if (!memories || memories.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No memories found with the specified filters"
          }]
        };
      }

      // Convert entities to plain objects for JSON serialization
      const result = memories.map(memory => ({
        id: memory.getId(),
        type: memory.getType(),
        content: memory.getContent(),
        source: memory.getSource(),
        tags: memory.getTags(),
        confidence: memory.getConfidence(),
        created_at: memory.getCreatedAt()
      }));

      return {
        content: [
          {
            type: "text",
            text: `Found ${result.length} memories:`
          },
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      Logger.error("Failed to list memories:", error);
      return {
        content: [{
          type: "text",
          text: `Failed to list memories: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool to delete a memory by ID
 */
server.registerTool(
  "memory_delete",
  {
    title: "Delete Memory",
    description: "Delete a memory by its ID",
    inputSchema: {
      id: z.number().int().positive().describe("Memory ID to delete")
    }
  },
  async ({ id }) => {
    try {
      // Find memory using repository pattern
      const memory = await aiagentmemoriesRepository.getById(id);

      if (!memory) {
        return {
          content: [{
            type: "text",
            text: `Memory with ID ${id} not found`
          }],
          isError: true
        };
      }

      // Delete the memory using repository pattern
      const memoryType = memory.getType();
      await memory.delete();
      
      Logger.info(`Memory deleted: ID ${id}, type: ${memoryType}`);
      return {
        content: [{
          type: "text",
          text: `Successfully deleted memory with ID ${id} (type: ${memoryType})`
        }]
      };
    } catch (error) {
      Logger.error("Failed to delete memory:", error);
      return {
        content: [{
          type: "text",
          text: `Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
);

/**
 * Start the server and initialize database
 */
async function main(): Promise<void> {
  try {
    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    Logger.info("Memory MCP Server started successfully");
  } catch (error) {
    Logger.error("Failed to start Memory server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
async function shutdown(): Promise<void> {
  try {
    Logger.info("Shutting down Memory MCP Server...");
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