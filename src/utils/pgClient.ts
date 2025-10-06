import { Pool, PoolClient } from 'pg';
import { config } from './config';
import Logger from './logger';

const pool = new Pool({
   user: config.DB_USER,
   host: config.DB_HOST,
   database: config.DB_NAME,
   password: config.DB_PASSWORD,
   port: config.DB_PORT,
});

pool.on('error', (err) => {
   Logger.error(`Database pool error: ${err.message}`);
});

export async function queryDatabase(query: string, values: any[] = []) {
   const client = await pool.connect();
   try {
      const res = await client.query(query, values);
      return res.rows;
   } catch (error) {
      Logger.error(`Database query failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
   } finally {
      client.release();
   }
}

export function closeDatabase() {
   return pool.end();
}