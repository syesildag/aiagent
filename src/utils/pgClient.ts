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
         // Increase pool size for multi-threaded usage
         max: 20,
         idleTimeoutMillis: 30000,
         connectionTimeoutMillis: 2000,
      });

      pool.on('error', (err) => {
         Logger.error(`[Pool ${poolId}] Database pool error: ${err.message}`);
      });

      // Add reference to prevent garbage collection in worker threads
      if (!isMainThread) {
         // In worker threads, add the pool to global scope to prevent GC
         (global as any).__dbPool = pool;
         Logger.debug(`[Pool ${poolId}] Added to global scope in worker thread to prevent GC`);
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
