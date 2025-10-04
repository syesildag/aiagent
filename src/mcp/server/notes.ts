#!/usr/bin/env node

/**
 * MCP Notes Server - A modern implementation using the high-level McpServer API
 * 
 * This server demonstrates MCP best practices:
 * - Using McpServer instead of low-level Server for better developer experience
 * - Zod schema validation for type safety and runtime validation
 * - Proper resource templates with URI patterns
 * - Error handling and validation
 * - Modern TypeScript patterns
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * Zod schema for note validation
 */
const NoteSchema = z.object({
  title: z.string().min(1, "Title cannot be empty"),
  content: z.string().min(1, "Content cannot be empty")
});

type Note = z.infer<typeof NoteSchema>;

/**
 * Simple in-memory storage for notes.
 * In a real implementation, this would likely be backed by a database.
 */
const notes: { [id: string]: Note } = {
  "1": { title: "First Note", content: "This is note 1" },
  "2": { title: "Second Note", content: "This is note 2" }
};

/**
 * Create a modern MCP server using the high-level McpServer API
 * This automatically handles capabilities registration and provides better DX
 */
const server = new McpServer({
  name: "notes-server",
  version: "0.1.0"
});

/**
 * Register dynamic notes resource with proper URI template
 * Uses the modern ResourceTemplate API for pattern matching
 */
server.registerResource(
  "note",
  new ResourceTemplate("note:///{id}", { 
    list: async () => ({
      resources: Object.entries(notes).map(([id, note]) => ({
        uri: `note:///${id}`,
        mimeType: "text/plain",
        name: note.title,
        description: `A text note: ${note.title}`
      }))
    })
  }),
  {
    title: "Note Resource",
    description: "Individual notes with content",
  },
  async (uri, { id }) => {
    const noteId = Array.isArray(id) ? id[0] : id;
    const note = notes[noteId];
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: "text/plain",
        text: `${note.title}\n\n${note.content}`
      }]
    };
  }
);

/**
 * Tool to create a new note with Zod validation
 * Demonstrates proper input schema validation and error handling
 */
server.registerTool(
  "create_note",
  {
    title: "Create Note",
    description: "Create a new note with title and content",
    inputSchema: {
      title: z.string().min(1, "Title cannot be empty"),
      content: z.string().min(1, "Content cannot be empty")
    }
  },
  async ({ title, content }) => {
    // Validate input using Zod schema
    const validatedData = NoteSchema.parse({ title, content });
    
    // Generate new ID (in production, use proper ID generation)
    const id = String(Math.max(0, ...Object.keys(notes).map(Number)) + 1);
    
    // Store the note
    notes[id] = validatedData;

    return {
      content: [{
        type: "text",
        text: `Created note ${id}: ${validatedData.title}`
      }]
    };
  }
);

/**
 * Tool to delete a note by ID
 * Shows parameter validation and error handling for missing resources
 */
server.registerTool(
  "delete_note",
  {
    title: "Delete Note",
    description: "Delete an existing note by its ID",
    inputSchema: {
      id: z.string().min(1, "Note ID cannot be empty")
    }
  },
  async ({ id }) => {
    const note = notes[id];
    if (!note) {
      throw new Error(`Note with ID ${id} not found`);
    }

    const noteTitle = note.title;
    delete notes[id];

    return {
      content: [{
        type: "text",
        text: `Successfully deleted note ${id}: ${noteTitle}`
      }]
    };
  }
);

/**
 * Tool to list all available notes
 * Returns ResourceLinks for better performance with large note collections
 */
server.registerTool(
  "list_notes",
  {
    title: "List Notes",
    description: "Get a list of all available notes with their titles",
    inputSchema: {
      includeContent: z.boolean().optional().describe("Include note content in the response")
    }
  },
  async ({ includeContent = false }) => {
    const noteEntries = Object.entries(notes);
    
    if (noteEntries.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No notes available."
        }]
      };
    }

    if (includeContent) {
      // Return full content
      const noteList = noteEntries
        .map(([id, note]) => `**${id}**: ${note.title}\n${note.content}`)
        .join('\n\n---\n\n');
      
      return {
        content: [{
          type: "text",
          text: `Found ${noteEntries.length} notes:\n\n${noteList}`
        }]
      };
    } else {
      // Return ResourceLinks for better performance
      const resourceLinks = noteEntries.map(([id, note]) => ({
        type: "resource_link" as const,
        uri: `note:///${id}`,
        name: note.title,
        mimeType: "text/plain",
        description: `Note: ${note.title}`
      }));

      return {
        content: [
          {
            type: "text",
            text: `Found ${noteEntries.length} notes:`
          },
          ...resourceLinks
        ]
      };
    }
  }
);

/**
 * Prompt to summarize all notes
 * Demonstrates embedding resources and creating structured prompts
 */
server.registerPrompt(
  "summarize_notes", 
  {
    title: "Summarize Notes",
    description: "Generate a concise summary of all notes in the system",
    argsSchema: {
      style: z.enum(["brief", "detailed", "bullet-points"]).optional()
    }
  },
  ({ style }) => {
    const selectedStyle = style ?? "brief";
    const noteCount = Object.keys(notes).length;
    
    if (noteCount === 0) {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: "No notes available to summarize."
          }
        }]
      };
    }

    const embeddedNotes = Object.entries(notes).map(([id, note]) => ({
      role: "user" as const,
      content: {
        type: "resource" as const,
        resource: {
          uri: `note:///${id}`,
          mimeType: "text/plain",
          text: `${note.title}\n\n${note.content}`
        }
      }
    }));

    const styleInstructions: Record<typeof selectedStyle, string> = {
      brief: "Provide a brief, one-paragraph summary",
      detailed: "Provide a detailed summary with key points from each note", 
      "bullet-points": "Provide a bullet-point summary of the main topics"
    };

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text", 
            text: `Please analyze the following ${noteCount} notes and ${styleInstructions[selectedStyle]}:`
          }
        },
        ...embeddedNotes,
        {
          role: "user",
          content: {
            type: "text",
            text: `Create a ${selectedStyle} summary of all the notes above, highlighting the main themes and important information.`
          }
        }
      ]
    };
  }
);

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main(): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    // Server is now running and will handle requests until the process is terminated
    console.error("Notes MCP Server started successfully");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error("Shutting down Notes MCP Server...");
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error("Shutting down Notes MCP Server...");
  process.exit(0);
});

main().catch((error) => {
  console.error("Unhandled server error:", error);
  process.exit(1);
});
