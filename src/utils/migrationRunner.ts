import fs from 'fs';
import path from 'path';
import { queryDatabase, withTransaction } from './pgClient';
import Logger from './logger';
import aiagentschemamigrationsRepository, { AiAgentSchemaMigrations } from '../entities/ai-agent-schema-migrations';

interface Migration {
  version: string;
  filename: string;
  description: string;
  sql: string;
}

export class MigrationRunner {
  private migrationsDir: string;

  constructor() {
    this.migrationsDir = path.resolve(process.cwd(), 'database/migrations');
  }

  /**
   * Ensure the ai_agent_schema_migrations table exists
   */
  private async ensureMigrationTable(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS public.ai_agent_schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        description TEXT
      );
    `;

    await queryDatabase(createTableSQL);
    Logger.info('Migration tracking table ensured');
  }

  /**
   * Get all migration files from the migrations directory
   */
  private getMigrationFiles(): Migration[] {
    if (!fs.existsSync(this.migrationsDir)) {
      throw new Error(`Migrations directory does not exist: ${this.migrationsDir}`);
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort to ensure proper order

    return files.map(filename => {
      const filePath = path.join(this.migrationsDir, filename);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Extract version from filename (e.g., "001_initial_schema.sql" -> "001")
      const versionMatch = filename.match(/^(\d+)_/);
      const version = versionMatch ? versionMatch[1] : filename.replace('.sql', '');

      // Extract description from filename or SQL comments
      let description = filename.replace(/^\d+_/, '').replace('.sql', '').replace(/_/g, ' ');

      // Try to extract description from SQL comments
      const descriptionMatch = sql.match(/-- Description: (.+)/);
      if (descriptionMatch) {
        description = descriptionMatch[1].trim();
      }

      return {
        version,
        filename,
        description,
        sql
      };
    });
  }

  /**
   * Get list of already applied migrations
   */
  private async getAppliedMigrations(): Promise<string[]> {
    try {
      const migrations = await aiagentschemamigrationsRepository.findAllOrderByVersionAsc();
      return migrations.map(migration => migration.getVersion());
    } catch (error) {
      // If table doesn't exist, return empty array
      Logger.warn('Could not fetch applied migrations, assuming none applied');
      return [];
    }
  }

  /**
   * Apply a single migration
   */
  private async applyMigration(migration: Migration): Promise<void> {
    Logger.info(`Applying migration ${migration.version}: ${migration.description}`);

    try {
      await withTransaction(async (query) => {
        // Execute the migration SQL
        await query(migration.sql);

        // Record the migration using repository pattern (if not already recorded by the migration itself)
        const migrationRecord = new AiAgentSchemaMigrations({
          version: migration.version,
          appliedAt: new Date(),
          description: migration.description
        });
        await migrationRecord.save();
      });

      Logger.info(`✓ Migration ${migration.version} applied successfully`);
    } catch (error) {
      throw new Error(`Failed to apply migration ${migration.version}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<void> {
    try {
      Logger.info('Connected to database for migrations');
      await this.ensureMigrationTable();

      const allMigrations = this.getMigrationFiles();
      const appliedMigrations = await this.getAppliedMigrations();

      Logger.info(`Found ${allMigrations.length} migration files`);
      Logger.info(`${appliedMigrations.length} migrations already applied`);

      const pendingMigrations = allMigrations.filter(
        migration => !appliedMigrations.includes(migration.version)
      );

      if (pendingMigrations.length === 0) {
        Logger.info('No pending migrations to run');
        return;
      }

      Logger.info(`Running ${pendingMigrations.length} pending migrations...`);

      for (const migration of pendingMigrations) {
        await this.applyMigration(migration);
      }

      Logger.info('All migrations completed successfully');

    } catch (error) {
      Logger.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Dynamically drop ai_agent database objects (tables, functions, extensions)
   */
  private async dropAllDatabaseObjects(): Promise<void> {
    try {
      // 1. Drop all ai_agent tables in the public schema
      Logger.info('Discovering ai_agent tables to drop...');
      const tables = await queryDatabase(`
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
        AND tablename LIKE 'ai_agent_%'
        ORDER BY tablename;
      `);

      if (tables.length > 0) {
        Logger.info(`Found ${tables.length} ai_agent tables to drop`);
        for (const table of tables) {
          const dropTableSQL = `DROP TABLE IF EXISTS public."${table.tablename}" CASCADE;`;
          await queryDatabase(dropTableSQL);
          Logger.info(`✓ Dropped table: ${table.tablename}`);
        }
      } else {
        Logger.info('No ai_agent tables found to drop');
      }

      // Also drop legacy schema_migrations table if it exists
      Logger.info('Checking for legacy schema_migrations table...');
      const legacyTable = await queryDatabase(`
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
        AND tablename = 'schema_migrations';
      `);

      if (legacyTable.length > 0) {
        await queryDatabase('DROP TABLE IF EXISTS public.schema_migrations CASCADE;');
        Logger.info('✓ Dropped legacy table: schema_migrations');
      }

      // 2. Drop extensions first (this will cascade and drop their functions)
      Logger.info('Discovering extensions to drop...');
      const extensions = await queryDatabase(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname NOT IN ('plpgsql', 'adminpack')
        ORDER BY extname;
      `);

      if (extensions.length > 0) {
        Logger.info(`Found ${extensions.length} extensions to drop`);
        for (const ext of extensions) {
          const dropExtensionSQL = `DROP EXTENSION IF EXISTS "${ext.extname}" CASCADE;`;
          await queryDatabase(dropExtensionSQL);
          Logger.info(`✓ Dropped extension: ${ext.extname}`);
        }
      } else {
        Logger.info('No custom extensions found to drop');
      }

      // 3. Drop ai_agent functions (after extensions are dropped)
      Logger.info('Discovering ai_agent functions to drop...');
      const functions = await queryDatabase(`
        SELECT 
          p.proname as function_name,
          pg_get_function_identity_arguments(p.oid) as function_args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND p.prokind = 'f'
        AND p.proname LIKE 'ai_agent_%'
        ORDER BY p.proname;
      `);

      if (functions.length > 0) {
        Logger.info(`Found ${functions.length} ai_agent functions to drop`);
        for (const func of functions) {
          const dropFunctionSQL = `DROP FUNCTION IF EXISTS public."${func.function_name}"(${func.function_args}) CASCADE;`;
          await queryDatabase(dropFunctionSQL);
          Logger.info(`✓ Dropped function: ${func.function_name}`);
        }
      } else {
        Logger.info('No ai_agent functions found to drop');
      }

      // 4. Drop ai_agent custom types in the public schema
      Logger.info('Discovering ai_agent custom types to drop...');
      const types = await queryDatabase(`
        SELECT typname 
        FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = 'public'
        AND t.typtype = 'e'  -- enum types
        AND typname LIKE 'ai_agent_%'
        ORDER BY typname;
      `);

      if (types.length > 0) {
        Logger.info(`Found ${types.length} ai_agent custom types to drop`);
        for (const type of types) {
          const dropTypeSQL = `DROP TYPE IF EXISTS public."${type.typname}" CASCADE;`;
          await queryDatabase(dropTypeSQL);
          Logger.info(`✓ Dropped type: ${type.typname}`);
        }
      } else {
        Logger.info('No ai_agent custom types found to drop');
      }

    } catch (error) {
      Logger.error('Error dropping database objects:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async getStatus(): Promise<void> {
    try {
      Logger.info('Connected to database for migrations');
      await this.ensureMigrationTable();

      const allMigrations = this.getMigrationFiles();
      const appliedMigrations = await this.getAppliedMigrations();

      console.log('\n=== Migration Status ===');
      console.log(`Total migrations: ${allMigrations.length}`);
      console.log(`Applied migrations: ${appliedMigrations.length}`);
      console.log(`Pending migrations: ${allMigrations.length - appliedMigrations.length}`);

      console.log('\n=== Migration Details ===');
      for (const migration of allMigrations) {
        const status = appliedMigrations.includes(migration.version) ? '✓ Applied' : '⏳ Pending';
        console.log(`${migration.version} - ${migration.description} [${status}]`);
      }

    } catch (error) {
      Logger.error('Failed to get migration status:', error);
      throw error;
    }
  }

  /**
   * Reset migrations (WARNING: This will drop all ai_agent tables/functions and rerun all migrations)
   */
  async reset(): Promise<void> {
    Logger.warn('DANGER: Resetting ai_agent migrations - this will drop all ai_agent data!');

    try {
      Logger.info('Connected to database for migrations');

      // Dynamically discover and drop all ai_agent tables, functions, and related objects
      await this.dropAllDatabaseObjects();
      Logger.info('All ai_agent database objects dropped');

      // Now run all migrations from scratch
      // Create a new instance for fresh migrations
      await this.runMigrations();

    } catch (error) {
      Logger.error('Migration reset failed:', error);
      throw error;
    }
  }
}