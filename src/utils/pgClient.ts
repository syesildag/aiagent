import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { isMainThread } from 'worker_threads';
import { config } from './config';
import Logger from './logger';

// Global pool instance - shared across threads via module system
let pool: Pool | null = null;
// Unique ID for the pool instance to verify sharing
let poolId: string | null = null;

function getPool(): Pool {
   if (!pool) {
      // Generate a unique ID for this pool instance ONLY upon creation.
      poolId = randomBytes(4).toString('hex');
      Logger.info(`Creating new PostgreSQL connection pool with ID: ${poolId} in ${isMainThread ? 'main thread' : 'worker thread'}`);

      pool = new Pool({
         user: config.DB_USER,
         host: config.DB_HOST,
         database: config.DB_NAME,
         password: config.DB_PASSWORD,
         port: config.DB_PORT,
         // Pool configuration from environment variables
         max: config.DB_POOL_MAX,
         idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT_MS,
         connectionTimeoutMillis: config.DB_POOL_CONNECTION_TIMEOUT_MS,
      });

      pool.on('error', (err) => {
         Logger.error(`[Pool ${poolId}] Database pool error: ${err.message}`);
      });

      // Add reference to prevent garbage collection in worker threads
      if (!isMainThread) {
         // In worker threads, add the pool to global scope to prevent GC
         (global as any).__dbPool = pool;
      }

      // Only set up cleanup in main thread
      if (isMainThread) {
         process.on('SIGINT', gracefulShutdown);
         process.on('SIGTERM', gracefulShutdown);
      }
   }
   return pool;
}

export async function queryDatabase(query: string, values: any[] = []) {
   const activePool = getPool();
   const client = await activePool.connect();
   try {
      const res = await client.query(query, values);
      return res.rows;
   } catch (error) {
      Logger.error(`[Pool ${poolId}] Database query failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
   } finally {
      client.release();
   }
}

/**
 * Execute multiple queries within a transaction
 * @param callback Function that receives a query function to execute queries within the transaction
 * @returns Promise that resolves with the callback result
 */
export async function withTransaction<T>(callback: (query: (sql: string, values?: any[]) => Promise<any[]>) => Promise<T>): Promise<T> {
   const activePool = getPool();
   const client = await activePool.connect();
   
   try {
      await client.query('BEGIN');
      
      // Create a query function that uses the transaction client
      const transactionQuery = async (sql: string, values: any[] = []) => {
         const res = await client.query(sql, values);
         return res.rows;
      };
      
      const result = await callback(transactionQuery);
      await client.query('COMMIT');
      return result;
   } catch (error) {
      await client.query('ROLLBACK');
      Logger.error(`[Pool ${poolId}] Transaction failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
   } finally {
      client.release();
   }
}

// Only allow main thread to close the database
export function closeDatabase() {
   if (!isMainThread) {
      Logger.warn(`[Pool ${poolId}] Worker thread attempted to close database pool - ignoring`);
      return Promise.resolve();
   }
   
   if (pool) {
      Logger.info(`[Pool ${poolId}] Closing database pool.`);
      const poolToClose = pool;
      pool = null;
      poolId = null;
      return poolToClose.end();
   }
   return Promise.resolve();
}

async function gracefulShutdown() {
   Logger.info('Gracefully shutting down database pool...');
   await closeDatabase();
}
