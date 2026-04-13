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
import { getEmbeddingService } from "../../utils/embeddingService.js";
import Logger from "../../utils/logger.js";
import { interpolateSql } from "../../utils/sqlUtils.js";
import { AiAgentMemories } from "../../entities/ai-agent-memories.js";
import aiagentmemoriesRepository from "../../entities/ai-agent-memories.js";

/**
 * Explicit TypeScript types for tool handler arguments.
 * These bypass the MCP SDK's Zod inference machinery which cannot handle
 * ZodUnion<[ZodRecord<ZodString,ZodAny>, ZodString]> without hitting
 * TypeScript's instantiation depth limit (TS2589).
 */
type CreateMemoryArgs = {
  type: string;
  content: Record<string, any> | string;
  source: string;
  tags?: string[];
  confidence: number;
  user_login?: string;
};

type SearchMemoryArgs = {
  query: string;
  type?: string;
  tags?: string[];
  limit?: number;
  min_similarity?: number;
  user_login?: string;
};

type ListMemoryArgs = {
  type?: string;
  tags?: string[];
  limit?: number;
  user_login?: string;
};

type DeleteMemoryArgs = {
  id: number;
};

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
// content uses z.any() to avoid TypeScript's recursive type instantiation
// limit (TS2589) caused by ZodUnion<[ZodRecord, ZodString]> in the MCP SDK.
const CreateMemoryInputSchema = z.object({
  type: z.string().min(1, "Memory type cannot be empty"),
  content: z.any().describe("Memory content (object or string)"),
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
  min_similarity: z.number().min(0).max(1).optional().describe("Minimum similarity threshold (0-1). Results below this score are excluded. Default is 0.5."),
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
      const memories = await aiagentmemoriesRepository.findAllByTypeOrderByCreatedAtDesc(memoryType);
      
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
  "mcreate",
  {
    title: "Create Memory",
    description: "Create a new memory entry with semantic embedding",
    inputSchema: CreateMemoryInputSchema.shape
  } as any,
  async (args) => {
    const { type, content, source, tags = [], confidence, user_login } = args as unknown as CreateMemoryArgs;
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
      const { embedding, embeddingModel } = await getEmbeddingService().generateEmbeddingWithMeta(textForEmbedding);

      if (!embedding || embedding.length === 0) {
        throw new Error("Failed to generate embedding for content");
      }

      // Create memory using repository pattern
      const memory = new AiAgentMemories({
        type: validatedData.type,
        content: contentForStorage,
        source: validatedData.source,
        embedding: `[${embedding.join(',')}]`,
        embeddingModel,
        tags: validatedData.tags,
        confidence: validatedData.confidence,
        userLogin: user_login,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      const savedMemory = await memory.save();
      const createdMemory = { id: savedMemory?.getId(), type: savedMemory?.getType() };
      Logger.info(`Memory created successfully with ID: ${createdMemory.id}`);

      // Optional: Clean up near-duplicate embeddings (threshold 0.95 catches
      // semantically identical memories that differ only in JSON key names).
      // Scoped by user_login and type so only truly identical memories of the
      // same category are merged. The older row (lower id) is removed in each
      // duplicate pair. Runs fire-and-forget so memory_create returns immediately.
      queryDatabase(`
        DELETE FROM ai_agent_memories WHERE id IN (
        SELECT m1.id
          FROM ai_agent_memories AS m1
         INNER JOIN ai_agent_memories AS m2
            ON m1.id <> m2.id
           AND m1.id < m2.id
         WHERE m1.embedding_model = m2.embedding_model
           AND m1.type = m2.type
           AND (1 - (m1.embedding <=> m2.embedding)) > 0.95
           AND (
             (m1.user_login IS NULL AND m2.user_login IS NULL)
             OR m1.user_login = m2.user_login
           )
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
  "msearch",
  {
    title: "Search Memories",
    description: "Search stored memories using semantic similarity. Use this whenever the user asks about personal context, preferences, location, past events, or anything that may have been remembered before (e.g. 'where am I', 'what do I like', 'remind me about X', 'what did we discuss').",
    inputSchema: SearchMemoryInputSchema.shape
  } as any,
  async (args) => {
    const { query, type, tags, limit = 10, min_similarity = 0.5, user_login } = args as unknown as SearchMemoryArgs;
    try {
      // Discover all distinct embedding models stored for matching memories so
      // that memories stored with a different embedding provider are not silently
      // excluded by a model-mismatch filter.
      let distinctModelsSql = `SELECT DISTINCT embedding_model FROM ai_agent_memories WHERE 1=1`;
      const distinctParams: any[] = [];
      let dpCount = 0;

      if (user_login) {
        dpCount++;
        distinctModelsSql += ` AND (user_login = $${dpCount} OR user_login IS NULL)`;
        distinctParams.push(user_login);
      }
      if (type) {
        dpCount++;
        distinctModelsSql += ` AND type = $${dpCount}`;
        distinctParams.push(type);
      }
      if (tags && tags.length > 0) {
        dpCount++;
        distinctModelsSql += ` AND tags && $${dpCount}::text[]`;
        distinctParams.push(tags);
      }

      const distinctRows = await queryDatabase(distinctModelsSql, distinctParams);
      const storedModels: string[] = distinctRows.map((r: any) => r.embedding_model as string);

      // If no memories exist for the given filters, bail out early.
      if (storedModels.length === 0) {
        Logger.debug(`[Memory] SQL: ${interpolateSql(distinctModelsSql, distinctParams)}`);
        Logger.info(`Found 0 memories for query: "${query}"`);
        return {
          content: [{
            type: "text",
            text: `No memories found for query: "${query}"`
          }]
        };
      }

      // For each stored model, generate a query embedding using the matching
      // provider so the vector comparison is dimension-safe.
      const searchResults = await Promise.allSettled(
        storedModels.map(async (storedModel: string) => {
          const providerName = storedModel.split(':')[0] as any;
          const { embedding: queryEmbedding, embeddingModel } = await getEmbeddingService().generateEmbeddingWithMeta(
            query,
            { provider: providerName }
          );
          if (!queryEmbedding || queryEmbedding.length === 0) {
            throw new Error(`Failed to generate embedding with provider "${providerName}"`);
          }

          const dim = queryEmbedding.length;
          let sqlQuery = `
            SELECT *, 1 - ((embedding::vector(${dim})) <=> $1::vector) as similarity
              FROM ai_agent_memories
             WHERE embedding_model = $2
          `;

          const queryParams: any[] = [`[${queryEmbedding.join(',')}]`, embeddingModel];
          let paramCount = 2;

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
            ORDER BY similarity DESC
            LIMIT $${paramCount + 1}
          `;
          queryParams.push(limit);

          const wrappedSql = `SELECT * FROM (${sqlQuery.trim()}) AS ranked WHERE similarity >= $${paramCount + 2}`;
          queryParams.push(min_similarity);

          Logger.debug(`[Memory] SQL (model=${embeddingModel}): ${interpolateSql(wrappedSql, queryParams)}`);
          return queryDatabase(wrappedSql, queryParams);
        })
      );

      // Merge results across all models, dedup by id keeping highest similarity.
      const seen = new Map<number, any>();
      for (const outcome of searchResults) {
        if (outcome.status === 'rejected') {
          Logger.warn(`[Memory] Search failed for one embedding model: ${outcome.reason}`);
          continue;
        }
        for (const row of outcome.value) {
          const existing = seen.get(row.id);
          if (!existing || row.similarity > existing.similarity) {
            seen.set(row.id, row);
          }
        }
      }

      const result = Array.from(seen.values())
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      Logger.info(`Found ${result.length} memories for query: "${query}"`);
      result.forEach((row: any) => {
        const content = typeof row.content === 'object' ? JSON.stringify(row.content) : String(row.content);
        Logger.debug(`[Memory] id=${row.id} type=${row.type} similarity=${(row.similarity * 100).toFixed(1)}% content="${content.substring(0, 120)}"`);
      });

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
  "mlist",
  {
    title: "List Memories",
    description: "List all memories with optional type and tag filters",
    inputSchema: ListMemoryInputSchema.shape
  } as any,
  async (args) => {
    const { type, tags, limit = 50, user_login } = args as unknown as ListMemoryArgs;
    try {
      let memories: AiAgentMemories[] | null = null;

      if (type && !tags && !user_login) {
        // Simple type filter - use repository pattern
        memories = await aiagentmemoriesRepository.findAllByTypeOrderByCreatedAtDesc(type);
        if (memories && limit < memories.length) {
          memories = memories.slice(0, limit);
        }
      } else if (user_login && type && !tags) {
        // User + type filter - use repository pattern
        memories = await aiagentmemoriesRepository.findAllByUserLoginAndTypeOrderByCreatedAtDesc(user_login, type);
        if (memories && limit < memories.length) {
          memories = memories.slice(0, limit);
        }
      } else if (user_login && !type && !tags) {
        // User-only filter - use repository pattern
        memories = await aiagentmemoriesRepository.findAllByUserLoginOrderByCreatedAtDesc(user_login);
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
/**
 * Tool to manually deduplicate memories using semantic similarity.
 * Removes older (lower id) entries where similarity exceeds the threshold.
 * Useful to clean up duplicates that accumulated before the automatic
 * dedup threshold was lowered.
 */
server.registerTool(
  "mdeduplicate",
  {
    title: "Deduplicate Memories",
    description: "Remove near-duplicate memories based on semantic similarity. Keeps the newest entry (highest id) in each duplicate pair. Scoped per user so cross-user memories are never affected.",
    inputSchema: {
      threshold: z.number().min(0).max(1).optional().describe("Cosine similarity threshold (0–1). Pairs above this value are considered duplicates. Defaults to 0.75."),
      user_login: z.string().optional().describe("Restrict deduplication to a specific user's memories. If omitted, deduplicates memories with no user_login (global memories)."),
      dry_run: z.boolean().optional().describe("If true, return the IDs that would be deleted without actually deleting them. Defaults to false."),
    }
  } as any,
  async (args) => {
    const { threshold = 0.75, user_login, dry_run = false } = args as unknown as { threshold?: number; user_login?: string; dry_run?: boolean };
    try {
      const userFilter = user_login
        ? `AND m1.user_login = $2 AND m2.user_login = $2`
        : `AND m1.user_login IS NULL AND m2.user_login IS NULL`;

      const selectSql = `
        SELECT m1.id, m1.type, m1.source,
               round((1 - (m1.embedding <=> m2.embedding))::numeric, 4) AS similarity,
               m2.id AS kept_id
          FROM ai_agent_memories AS m1
         INNER JOIN ai_agent_memories AS m2
            ON m1.id <> m2.id
           AND m1.id < m2.id
         WHERE (1 - (m1.embedding <=> m2.embedding)) > $1
           ${userFilter}
         ORDER BY similarity DESC
      `;

      const queryParams = user_login ? [threshold, user_login] : [threshold];
      const duplicates = await queryDatabase(selectSql, queryParams);
      const rows = duplicates as Array<{ id: number; type: string; source: string; similarity: string; kept_id: number }>;

      if (rows.length === 0) {
        return { content: [{ type: "text", text: `No duplicate memories found above similarity threshold ${threshold}.` }] };
      }

      if (dry_run) {
        const summary = rows.map(r => `  ID ${r.id} (type: ${r.type}) — similarity ${r.similarity} with ID ${r.kept_id} (kept)`).join('\n');
        return { content: [{ type: "text", text: `Dry run — ${rows.length} memory/memories would be deleted:\n${summary}` }] };
      }

      const deleteSql = `
        DELETE FROM ai_agent_memories WHERE id IN (
          SELECT m1.id
            FROM ai_agent_memories AS m1
           INNER JOIN ai_agent_memories AS m2
              ON m1.id <> m2.id
             AND m1.id < m2.id
           WHERE (1 - (m1.embedding <=> m2.embedding)) > $1
             ${userFilter}
        )
      `;
      await queryDatabase(deleteSql, queryParams);

      Logger.info(`memory_deduplicate: removed ${rows.length} duplicate(s) with threshold ${threshold}`);
      return { content: [{ type: "text", text: `Deleted ${rows.length} duplicate memory/memories (threshold: ${threshold}). Newest entries were kept.` }] };
    } catch (error) {
      Logger.error("Failed to deduplicate memories:", error);
      return {
        content: [{ type: "text", text: `Failed to deduplicate: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }
);

server.registerTool(
  "mdelete",
  {
    title: "Delete Memory",
    description: "Delete a memory by its ID",
    inputSchema: {
      id: z.number().int().positive().describe("Memory ID to delete")
    }
  } as any,
  async (args) => {
    const { id } = args as unknown as DeleteMemoryArgs;
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