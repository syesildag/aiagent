/**
 * Simple test for DbConversationHistory functionality
 * Tests basic database connection and table operations
 */

import { Pool } from 'pg';
import { config } from './config';

// Skip database integration tests if no database is available
const shouldRunDatabaseTests = process.env.RUN_DB_TESTS === 'true';
const describeDatabase = shouldRunDatabaseTests ? describe : describe.skip;

describeDatabase('DbConversationHistory Database Integration', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      user: config.DB_USER,
      host: config.DB_HOST,
      database: config.DB_NAME,
      password: config.DB_PASSWORD,
      port: config.DB_PORT,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  test('should connect to database and verify tables exist', async () => {
    const client = await pool.connect();
    
    try {
      // Check that conversation tables exist
      const tablesResult = await client.query(`
        SELECT tablename FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename IN ('ai_agent_conversations', 'ai_agent_conversation_messages')
        ORDER BY tablename
      `);
      
      expect(tablesResult.rows).toHaveLength(2);
      expect(tablesResult.rows[0].tablename).toBe('ai_agent_conversation_messages');
      expect(tablesResult.rows[1].tablename).toBe('ai_agent_conversations');
      
      // Check conversation table structure
      const conversationColumns = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'ai_agent_conversations'
        ORDER BY ordinal_position
      `);
      
      const columnNames = conversationColumns.rows.map(row => row.column_name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('session_id');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
      expect(columnNames).toContain('metadata');
      
      // Check message table structure  
      const messageColumns = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'ai_agent_conversation_messages'
        ORDER BY ordinal_position
      `);
      
      const messageColumnNames = messageColumns.rows.map(row => row.column_name);
      expect(messageColumnNames).toContain('id');
      expect(messageColumnNames).toContain('conversation_id');
      expect(messageColumnNames).toContain('role');
      expect(messageColumnNames).toContain('content');
      expect(messageColumnNames).toContain('created_at');
      expect(messageColumnNames).toContain('metadata');
      
    } finally {
      client.release();
    }
  });

  test('should verify migration tracking table exists', async () => {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT version, description, applied_at
        FROM ai_agent_schema_migrations
        ORDER BY version
      `);
      
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].version).toBe('001');
      expect(result.rows[1].version).toBe('002');
      expect(result.rows[0].description).toContain('initial database schema');
      expect(result.rows[1].description).toContain('conversations and conversation messages');
      
    } finally {
      client.release();
    }
  });

  test('should be able to insert and retrieve conversation data', async () => {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert a test conversation
      const conversationResult = await client.query(`
        INSERT INTO ai_agent_conversations (session_id, user_id, metadata)
        VALUES (1, 'test_user', '{"test": true}')
        RETURNING id, session_id, user_id, created_at, metadata
      `);
      
      expect(conversationResult.rows).toHaveLength(1);
      const conversation = conversationResult.rows[0];
      expect(conversation.session_id).toBe(1);
      expect(conversation.user_id).toBe('test_user');
      expect(conversation.metadata).toEqual({ test: true });
      
      // Insert a test message
      const messageResult = await client.query(`
        INSERT INTO ai_agent_conversation_messages (conversation_id, role, content, metadata)
        VALUES ($1, 'user', 'Hello, world!', '{"test_message": true}')
        RETURNING id, conversation_id, role, content, created_at, metadata
      `, [conversation.id]);
      
      expect(messageResult.rows).toHaveLength(1);
      const message = messageResult.rows[0];
      expect(message.conversation_id).toBe(conversation.id);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
      expect(message.metadata).toEqual({ test_message: true });
      
      await client.query('ROLLBACK'); // Clean up test data
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
});