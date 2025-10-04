import { Pool } from 'pg';
import { ConsoleLogger } from './logger.js';
import { config } from './config.js';
import { PostgreSQLEntityGenerator, entityGenerator } from './postgresEntityGenerator.js';

/**
 * CLI Entry Point for PostgreSQL Entity Generator
 * 
 * Usage examples:
 * - Generate single entity: npm run generate-entity -- --table session --output ./src/entities
 * - Generate all entities: npm run generate-entity -- --schema public --output ./src/entities --overwrite
 * - Generate with custom base class: npm run generate-entity -- --table users --base-class BaseEntity
 */

async function main() {
  const logger = new ConsoleLogger();
  let pool: Pool | undefined;

  try {
    // Initialize database connection
    pool = new Pool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
    });

    // Test database connection
    await pool.query('SELECT 1');
    logger.info('Database connection established');

    // Initialize generator
    const generator = new PostgreSQLEntityGenerator(pool, logger);
    const cli = new entityGenerator(generator);

    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      printUsage();
      process.exit(0);
    }

    // Execute generation based on arguments
    await cli.executeFromArgs(args);

  } catch (error) {
    logger.error('Entity generation failed:', error);
    process.exit(1);
  } finally {
    // Clean up database connection
    if (pool) {
      await pool.end();
      logger.info('Database connection closed');
    }
  }
}

function printUsage() {
  console.log(`
PostgreSQL Entity Generator CLI

Usage:
  npm run generate-entity -- [OPTIONS]

Options:
  --table <name>           Generate entity for specific table
  --schema <name>          Generate entities for all tables in schema (default: public)
  --output, -o <path>      Output directory for generated files (default: ./src/entities)
  --base-class <name>      Base class for entities (default: Entity)
  --overwrite              Overwrite existing files
  --no-relationships       Skip relationship generation
  --help, -h               Show this help message

Examples:
  # Generate entity for 'session' table
  npm run generate-entity -- --table session

  # Generate all entities in public schema
  npm run generate-entity -- --schema public --output ./generated --overwrite

  # Generate entity with custom base class
  npm run generate-entity -- --table users --base-class BaseModel

  # Generate without relationships
  npm run generate-entity -- --table logs --no-relationships
  `);
}

// Run the CLI if this file is executed directly
const isMainModule = process.argv[1]?.endsWith('entityGenerator.ts') || 
                    process.argv[1]?.endsWith('entityGenerator.js');
if (isMainModule) {
  main().catch(console.error);
}

export { main, printUsage };