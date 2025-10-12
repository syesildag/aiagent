#!/usr/bin/env node

import Logger from '../utils/logger';
import { MigrationRunner } from '../utils/migrationRunner';
import { closeDatabase } from '../utils/pgClient';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const runner = new MigrationRunner();

  try {
    switch (command) {
      case 'run':
      case 'migrate':
      case undefined: // Default to run when no command provided
        await runner.runMigrations();
        break;
        
      case 'status':
        await runner.getStatus();
        break;
        
      case 'reset':
        console.log('⚠️  WARNING: This will delete ALL database data!');
        console.log('Type "yes" to confirm migration reset:');
        
        // Simple confirmation (in a real app, you'd use a proper prompt library)
        const confirmation = await new Promise<string>((resolve) => {
          process.stdin.once('data', (data) => {
            resolve(data.toString().trim());
          });
        });
        
        if (confirmation.toLowerCase() === 'yes') {
          await runner.reset();
        } else {
          console.log('Migration reset cancelled');
        }
        break;
        
      default:
        console.log(`
Database Migration Tool

Usage:
  npm run migrate [command]

Commands:
  run, migrate    Run all pending migrations
  status          Show migration status
  reset           Reset all migrations (DANGER: deletes all data)

Examples:
  npm run migrate run
  npm run migrate status
  npm run migrate reset
        `);
        break;
    }
  } catch (error) {
    Logger.error('Migration command failed:', error);
    process.exit(1);
  }
  finally {
    gracefulShutdown();
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nMigration interrupted');
  gracefulShutdown();
});

process.on('SIGTERM', () => {
  console.log('\nMigration terminated');
  gracefulShutdown();
});

function gracefulShutdown() {
  console.log('\nGracefully shutting down...');
  closeDatabase().then(() => {
    process.exit(0);
  });
}

main();