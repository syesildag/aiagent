#!/usr/bin/env node
/**
 * Example usage of insertEmbeddings script
 * 
 * Usage:
 *   npm run build && node dist/scripts/insertEmbeddingsExample.js
 */

import insertEmbeddings, { DocumentInput } from '../scripts/insertEmbeddings';
import Logger from '../utils/logger';

async function runExample() {
  // Sample documents to insert
  const documents: DocumentInput[] = [
    {
      name: "AI Agent Architecture Overview",
      content: "The AI agent system is built on a modular architecture with three main components: the conversation manager, the tool registry, and the LLM provider abstraction. The conversation manager handles context and memory, while the tool registry provides dynamic capability discovery.",
      type: "architecture"
    },
    {
      name: "Entity Repository Pattern Guide", 
      content: "Our repository pattern provides a clean abstraction over database operations. Each entity has a corresponding repository that handles CRUD operations, relationships, and query building. Repositories use decorators for metadata and support automatic query generation.",
      type: "documentation"
    },
    {
      name: "MCP Server Integration",
      content: "Model Context Protocol (MCP) servers provide external tool capabilities to the AI agent. The system supports dynamic server discovery, capability negotiation, and secure tool execution with proper error handling and timeouts.",
      type: "integration"
    },
    {
      name: "Embedding Service Configuration",
      content: "The embedding service supports multiple providers including OpenAI, Ollama, and local models. It provides automatic fallback, caching, batch processing, and similarity search capabilities. Configuration is managed through environment variables.",
      type: "configuration"
    },
    {
      name: "Database Schema Design",
      content: "The database schema follows a normalized design with proper foreign key relationships. Key tables include ai_agent_session for user sessions, ai_agent_document for document storage with vector embeddings, and ai_agent_user for authentication.",
      type: "database"
    }
  ];

  Logger.info('Starting embedding insertion example...');

  try {
    const results = await insertEmbeddings(documents, {
      embeddingModel: 'text-embedding-3-small',
      embeddingProvider: 'openai',
      batchSize: 3
    });

    Logger.info(`✅ Successfully inserted ${results.length} documents`);
    
    // Display summary
    console.log('\n📄 Inserted Documents:');
    results.forEach((doc, index) => {
      console.log(`${index + 1}. ${doc.getName()}`);
      console.log(`   ID: ${doc.getId()}`);
      console.log(`   Type: ${doc.getTypeId()}`);
      console.log(`   Content length: ${doc.getContent().length} chars`);
      console.log(`   Has embedding: ${doc.getEmbedding() ? 'Yes' : 'No'}`);
      console.log('');
    });

  } catch (error) {
    Logger.error('❌ Example failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runExample().catch(error => {
    console.error('Example execution failed:', error);
    process.exit(1);
  });
}

export default runExample;