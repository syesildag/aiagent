import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '../utils/config';

async function runMigration() {
  const sqlPath = path.resolve(process.cwd(), 'database/migrations/002_add_conversations_tables.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
  });

  try {
    await client.connect();
    console.log('Connected to database');
    
    await client.query(sql);
    console.log('Migration 002_add_conversations_tables.sql executed successfully.');
  } catch (err) {
    console.error('Error running migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();