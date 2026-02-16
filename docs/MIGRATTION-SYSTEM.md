# Database Migration System

This document describes the organized database migration system for the AI Agent project.

## Overview

The migration system provides a structured way to manage database schema changes with:
- ✅ Sequential migration versioning
- ✅ Migration tracking and status reporting  
- ✅ Automatic rollback on failures
- ✅ CLI tools for easy management

## Directory Structure

```
database/
└── migrations/
    ├── 001_initial_schema.sql      # Initial database setup
    ├── 002_add_conversations_tables.sql  # Conversation history tables
    └── ...                         # Future migrations
```

## Migration Files

Each migration file follows the naming convention: `{version}_{description}.sql`

### Example Migration Structure
```sql
-- Migration: 001_initial_schema  
-- Description: Create initial database schema with users, sessions, documents, and memories
-- Created: 2025-10-12

-- SQL statements here...

-- Record this migration (optional - system will auto-record if missing)
INSERT INTO public.schema_migrations (version, description) 
VALUES ('001', 'Create initial database schema with users, sessions, documents, and memories')
ON CONFLICT (version) DO NOTHING;
```

## Usage

### Run All Pending Migrations
```bash
npm run migrate
# or
npm run migrate run
```

### Check Migration Status
```bash
npm run migrate:status
```

### Reset All Migrations (⚠️ DANGER: Deletes all data)
```bash
npm run migrate:reset
```

## Migration Tracking

The system uses a `schema_migrations` table to track applied migrations:

```sql
CREATE TABLE public.schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);
```

## Features

### 1. Sequential Execution
- Migrations run in version order (001, 002, 003...)
- Only pending migrations are executed
- Previously applied migrations are skipped

### 2. Transaction Safety
- Each migration runs in its own transaction
- Automatic rollback on any SQL error
- Database remains consistent even if migration fails

### 3. Status Reporting
```bash
npm run migrate:status

=== Migration Status ===
Total migrations: 2
Applied migrations: 1
Pending migrations: 1

=== Migration Details ===
001 - Create initial database schema with users, sessions, documents, and memories [✓ Applied]
002 - Add conversations and conversation messages tables for persistent chat history [⏳ Pending]
```

### 4. Error Handling
- Detailed error messages with migration context
- Automatic transaction rollback on failures
- Graceful handling of connection issues

## Creating New Migrations

1. **Create the migration file:**
   ```bash
   touch database/migrations/003_add_new_feature.sql
   ```

2. **Follow the template:**
   ```sql
   -- Migration: 003_add_new_feature
   -- Description: Add new feature tables and indexes
   -- Created: 2025-10-12

   -- Your SQL statements here
   CREATE TABLE IF NOT EXISTS new_feature (...);

   -- Record migration (optional)
   INSERT INTO public.schema_migrations (version, description) 
   VALUES ('003', 'Add new feature tables and indexes')
   ON CONFLICT (version) DO NOTHING;
   ```

3. **Run the migration:**
   ```bash
   npm run migrate
   ```

## Best Practices

### ✅ Do:
- Use descriptive migration names
- Include comments explaining complex changes
- Use `IF NOT EXISTS` for idempotent operations
- Test migrations on development database first
- Include proper indexes for performance

### ❌ Don't:
- Modify existing migration files after they're applied
- Use `DROP TABLE` without careful consideration
- Forget to backup production data before major changes
- Skip version numbers in migration files

## Integration with Application

The migration system integrates seamlessly with the existing application:

### Development Workflow
```bash
# 1. Build and run migrations
npm run build
npm run migrate

# 2. Generate entities from new tables
npm run entityGen --table new_table_name

# 3. Start development
npm run dev
```

### Docker/Production Deployment
```bash
# Docker script automatically runs migrations
npm run docker

# Or manually in production
npm run migrate
npm start
```

## Troubleshooting

### Migration Stuck or Failed
1. Check migration status: `npm run migrate:status`
2. Review database logs for specific errors
3. Fix the problematic SQL in the migration file
4. If needed, manually remove the failed migration from `schema_migrations` table
5. Re-run migrations: `npm run migrate`

### Starting Fresh (Development Only)
```bash
# ⚠️ WARNING: This deletes ALL database data
npm run migrate:reset
```

### Manual Migration Management
```typescript
import { MigrationRunner } from './src/utils/migrationRunner';

const runner = new MigrationRunner();
await runner.runMigrations();
await runner.getStatus();
```

## File Structure After Organization

```
database/
└── migrations/                    # All migration files
    ├── 001_initial_schema.sql     # Users, sessions, documents, memories
    └── 002_add_conversations_tables.sql  # Conversation history

src/
├── scripts/
│   └── migrate.ts                 # CLI migration tool
└── utils/
    └── migrationRunner.ts         # Core migration logic

# Old files removed:
# ❌ database/init.sql             # Replaced by 001_initial_schema.sql
# ❌ src/scripts/initSql.ts        # Replaced by migrate.ts
# ❌ src/scripts/runMigration.ts   # Replaced by unified system
```

## Future Enhancements

Potential improvements for the migration system:

1. **Migration Generation**: CLI tool to generate migration templates
2. **Rollback Support**: Add down migrations for reversible changes
3. **Environment-Specific Migrations**: Different migrations for dev/prod
4. **Migration Validation**: Syntax checking before execution
5. **Backup Integration**: Automatic database backups before major migrations