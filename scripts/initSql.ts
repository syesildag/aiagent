import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '../src/utils/config';

async function initSql() {
  const sqlPath = path.resolve(__dirname, '../database/init.sql');
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
    await client.query(sql);
    console.log('SQL injected successfully.');
  } catch (err) {
    console.error('Error injecting SQL:', err);
  } finally {
    await client.end();
  }
}

initSql();
