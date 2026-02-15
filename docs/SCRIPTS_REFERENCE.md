# Scripts Reference

## Overview

This document describes the utility scripts available in the `src/scripts/` directory for database management, user administration, and system maintenance.

## Available Scripts

### addUser.ts

Creates a new user account.

**Usage:**
```bash
npm run build
node dist/scripts/addUser.js
```

**Interactive Prompts:**
```
Enter username: johndoe
Enter email: john@example.com
Enter password: ********
Confirm password: ********

✅ User created successfully!
User ID: 123
Username: johndoe
Email: john@example.com
```

**Programmatic Usage:**
```typescript
import { createUser } from './scripts/addUser';

const user = await createUser({
   username: 'johndoe',
   email: 'john@example.com',
   password: 'SecurePass123!'
});
```

**Validation:**
- Username: 3-50 characters, alphanumeric + underscore
- Email: Valid email format
- Password: Minimum 8 characters

---

### deleteExpiredSessions.ts

Deletes all expired sessions from the database.

**Usage:**
```bash
npm run build
node dist/scripts/deleteExpiredSessions.js
```

**Output:**
```
Deleting expired sessions...
✅ Deleted 42 expired sessions
```

**Implementation:**
```typescript
import deleteExpiredSessions from './scripts/deleteExpiredSessions';

const count = await deleteExpiredSessions();
console.log(`Deleted ${count} sessions`);
```

**Scheduled Execution:**
Automatically runs every minute via SessionTimeout job.

---

### deleteAllSessions.ts

Deletes ALL sessions (use with caution).

**Usage:**
```bash
npm run build
node dist/scripts/deleteAllSessions.js
```

**Confirmation Required:**
```
⚠️  WARNING: This will delete ALL sessions!
Are you sure? (yes/no): yes

Deleting all sessions...
✅ Deleted 150 sessions
```

**Use Cases:**
- Testing environments
- Emergency logout all users
- Database cleanup/reset

---

### migrate.ts

Runs database migrations.

**Usage:**
```bash
npm run build
node dist/scripts/migrate.js
```

**Options:**
```bash
# Run all pending migrations
node dist/scripts/migrate.js

# Dry run (show SQL without executing)
node dist/scripts/migrate.js --dry-run

# Rollback last migration
node dist/scripts/migrate.js --rollback

# Show migration status
node dist/scripts/migrate.js --status
```

**Output:**
```
Checking for pending migrations...
Found 2 pending migrations:
  - 003_add_embeddings.sql
  - 004_add_indexes.sql

Running migrations...
✅ Applied 003_add_embeddings.sql
✅ Applied 004_add_indexes.sql

All migrations complete!
```

**Migration Files Location:**
```
database/migrations/
├── 001_initial_schema.sql
├── 002_add_conversations_tables.sql
└── 003_add_embeddings.sql
```

See [Migration System](Migration-System.md) for details.

---

### insertEmbeddings.ts

Generates and inserts embeddings for documents.

**Usage:**
```bash
npm run build
node dist/scripts/insertEmbeddings.js
```

**Options:**
```bash
# Use specific provider
node dist/scripts/insertEmbeddings.js --provider openai

# Use specific model
node dist/scripts/insertEmbeddings.js --model text-embedding-3-large

# Process specific table
node dist/scripts/insertEmbeddings.js --table documents

# Batch size
node dist/scripts/insertEmbeddings.js --batch-size 100

# Force regenerate existing embeddings
node dist/scripts/insertEmbeddings.js --force
```

**Example:**
```bash
node dist/scripts/insertEmbeddings.js \
  --provider openai \
  --model text-embedding-3-small \
  --table ai_agent_document \
  --batch-size 50
```

**Output:**
```
Loading documents without embeddings...
Found 250 documents

Generating embeddings...
Progress: [████████████████████] 100% (250/250)

Inserting embeddings into database...
✅ Inserted 250 embeddings

Total duration: 45.2 seconds
Average: 0.18s per document
```

See [INSERT_EMBEDDINGS_GUIDE.md](INSERT_EMBEDDINGS_GUIDE.md) for details.

---

## Creating Custom Scripts

### Basic Script Template

```typescript
// src/scripts/myScript.ts
import { closeDatabase, queryDatabase } from '../utils/pgClient';
import Logger from '../utils/logger';
import { config } from '../utils/config';

async function main() {
   try {
      Logger.info('Starting my custom script...');
      
      // Your script logic here
      const result = await queryDatabase(
         'SELECT COUNT(*) FROM my_table',
         []
      );
      
      Logger.info(`Result: ${result.rows[0].count}`);
      
      Logger.info('Script completed successfully');
   } catch (error) {
      Logger.error(`Script failed: ${error}`);
      process.exit(1);
   } finally {
      await closeDatabase();
   }
}

// Only run if invoked directly
if (require.main === module) {
   main();
}

export default main;
```

### Script with CLI Arguments

```typescript
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface ScriptArgs {
   input: string;
   output: string;
   verbose: boolean;
}

const argv = yargs(hideBin(process.argv))
   .option('input', {
      alias: 'i',
      type: 'string',
      description: 'Input file path',
      demandOption: true
   })
   .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output file path',
      default: 'output.json'
   })
   .option('verbose', {
      alias: 'v',
      type: 'boolean',
      description: 'Verbose logging',
      default: false
   })
   .argv as ScriptArgs;

async function main(args: ScriptArgs) {
   if (args.verbose) {
      Logger.setLevel('debug');
   }
   
   Logger.info(`Reading from ${args.input}`);
   Logger.info(`Writing to ${args.output}`);
   
   // Script logic...
}

main(argv);
```

### Script with Progress Bar

```typescript
import cliProgress from 'cli-progress';

async function processItems(items: any[]) {
   const progressBar = new cliProgress.SingleBar({
      format: 'Progress |{bar}| {percentage}% | {value}/{total} items',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
   });
   
   progressBar.start(items.length, 0);
   
   for (let i = 0; i < items.length; i++) {
      await processItem(items[i]);
      progressBar.update(i + 1);
   }
   
   progressBar.stop();
}
```

### Script with Confirmation

```typescript
import readline from 'readline';

async function confirmAction(message: string): Promise<boolean> {
   const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
   });
   
   return new Promise((resolve) => {
      rl.question(`${message} (yes/no): `, (answer) => {
         rl.close();
         resolve(answer.toLowerCase() === 'yes');
      });
   });
}

async function main() {
   const confirmed = await confirmAction('⚠️  Delete all data?');
   
   if (!confirmed) {
      Logger.info('Operation cancelled');
      return;
   }
   
   // Proceed with deletion...
}
```

## Batch Processing Scripts

### Batch Update Example

```typescript
// src/scripts/batchUpdate.ts
async function batchUpdate(batchSize: number = 100) {
   const total = await getRecordCount();
   let processed = 0;
   
   Logger.info(`Processing ${total} records in batches of ${batchSize}`);
   
   while (processed < total) {
      const batch = await queryDatabase(
         'SELECT * FROM records ORDER BY id LIMIT $1 OFFSET $2',
         [batchSize, processed]
      );
      
      for (const record of batch.rows) {
         await processRecord(record);
      }
      
      processed += batch.rows.length;
      Logger.info(`Progress: ${processed}/${total}`);
   }
   
   Logger.info('Batch processing complete');
}
```

### Parallel Processing

```typescript
import pLimit from 'p-limit';

async function parallelProcess(items: any[], concurrency: number = 5) {
   const limit = pLimit(concurrency);
   
   const promises = items.map(item =>
      limit(() => processItem(item))
   );
   
   const results = await Promise.all(promises);
   return results;
}
```

## Database Maintenance Scripts

### Vacuum Database

```typescript
// src/scripts/vacuumDatabase.ts
async function vacuumDatabase() {
   Logger.info('Running VACUUM ANALYZE...');
   
   await queryDatabase('VACUUM ANALYZE', []);
   
   Logger.info('Vacuum complete');
}
```

### Check Database Health

```typescript
// src/scripts/checkDatabaseHealth.ts
async function checkDatabaseHealth() {
   const checks = {
      size: await getDatabaseSize(),
      connections: await getConnectionCount(),
      locks: await getActiveLocks(),
      slowQueries: await getSlowQueries()
   };
   
   Logger.info('Database Health:');
   Logger.info(`  Size: ${checks.size}`);
   Logger.info(`  Connections: ${checks.connections}`);
   Logger.info(`  Active Locks: ${checks.locks}`);
   Logger.info(`  Slow Queries: ${checks.slowQueries}`);
   
   return checks;
}
```

### Backup Database

```typescript
// src/scripts/backupDatabase.ts
import { spawn } from 'child_process';

async function backupDatabase(outputFile: string) {
   return new Promise((resolve, reject) => {
      const pg_dump = spawn('pg_dump', [
         '-h', config.DB_HOST,
         '-U', config.DB_USER,
         '-d', config.DB_NAME,
         '-f', outputFile
      ]);
      
      pg_dump.on('close', (code) => {
         if (code === 0) {
            Logger.info(`Backup saved to ${outputFile}`);
            resolve(outputFile);
         } else {
            reject(new Error(`Backup failed with code ${code}`));
         }
      });
   });
}
```

## Error Handling

### Graceful Error Handling

```typescript
async function main() {
   try {
      await performOperation();
   } catch (error) {
      if (error.code === '23505') {
         Logger.error('Duplicate key error');
      } else if (error.code === '23503') {
         Logger.error('Foreign key violation');
      } else {
         Logger.error(`Unexpected error: ${error.message}`);
      }
      
      process.exit(1);
   } finally {
      await cleanup();
   }
}
```

### Retry Logic

```typescript
async function withRetry<T>(
   fn: () => Promise<T>,
   maxRetries: number = 3
): Promise<T> {
   for (let i = 0; i < maxRetries; i++) {
      try {
         return await fn();
      } catch (error) {
         if (i === maxRetries - 1) throw error;
         
         const delay = Math.pow(2, i) * 1000;
         Logger.warn(`Retry ${i + 1}/${maxRetries} after ${delay}ms`);
         await new Promise(resolve => setTimeout(resolve, delay));
      }
   }
   throw new Error('Should not reach here');
}
```

## Testing Scripts

### Dry Run Mode

```typescript
const DRY_RUN = process.env.DRY_RUN === 'true';

async function deleteRecords(ids: number[]) {
   if (DRY_RUN) {
      Logger.info(`[DRY RUN] Would delete ${ids.length} records`);
      return 0;
   }
   
   const result = await queryDatabase(
      'DELETE FROM records WHERE id = ANY($1)',
      [ids]
   );
   
   return result.rowCount;
}
```

### Script Unit Tests

```typescript
// src/scripts/myScript.test.ts
import myScript from './myScript';

describe('myScript', () => {
   test('should process data correctly', async () => {
      const result = await myScript({ input: 'test.json' });
      expect(result).toBeDefined();
   });
});
```

## Best Practices

### 1. Always Close Database

```typescript
async function main() {
   try {
      // Script logic
   } finally {
      await closeDatabase();
   }
}
```

### 2. Log Progress

```typescript
Logger.info('Starting operation...');
Logger.info(`Processing ${count} items`);
Logger.info('✅ Operation complete');
```

### 3. Handle Interrupts

```typescript
process.on('SIGINT', async () => {
   Logger.warn('Interrupted by user');
   await cleanup();
   process.exit(130);
});
```

### 4. Validate Inputs

```typescript
if (!fs.existsSync(inputFile)) {
   Logger.error(`Input file not found: ${inputFile}`);
   process.exit(1);
}
```

### 5. Use Transactions

```typescript
const client = await getClient();
try {
   await client.query('BEGIN');
   
   // Multiple operations
   await client.query('UPDATE ...');
   await client.query('INSERT ...');
   
   await client.query('COMMIT');
} catch (error) {
   await client.query('ROLLBACK');
   throw error;
} finally {
   client.release();
}
```

## Scheduling Scripts

### Using Cron

```bash
# Run daily at 2 AM
0 2 * * * cd /path/to/project && node dist/scripts/cleanup.js

# Run every hour
0 * * * * cd /path/to/project && node dist/scripts/sync.js
```

### Using Node Schedule

```typescript
import schedule from 'node-schedule';
import myScript from './scripts/myScript';

// Run every day at 2 AM
schedule.scheduleJob('0 2 * * *', async () => {
   await myScript();
});
```

## Related Documentation

- [Job System](JOB_SYSTEM.md)
- [Worker System](WORKER_SYSTEM.md)
- [Migration System](Migration-System.md)
- [INSERT_EMBEDDINGS_GUIDE.md](INSERT_EMBEDDINGS_GUIDE.md)
