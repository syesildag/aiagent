# Entity Creation Guide

This guide explains how to create TypeScript entity classes for your PostgreSQL database tables using the automated entity generator and manual creation methods.

## Table of Contents
- [Automated Entity Generation](#automated-entity-generation)
- [Manual Entity Creation](#manual-entity-creation)
- [Entity Structure Overview](#entity-structure-overview)
- [Annotations Reference](#annotations-reference)
- [Repository Pattern](#repository-pattern)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Automated Entity Generation

### Prerequisites
Ensure your PostgreSQL database is running and properly configured in your environment variables:

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=your_database
POSTGRES_USER=your_user
POSTGRES_PASSWORD=your_password
```

### Quick Start

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Generate entity for a single table:**
   ```bash
   node dist/utils/entityGenerator.js --table <table_name> --output src/repository/entities
   ```

3. **Generate entities for entire schema:**
   ```bash
   node dist/utils/entityGenerator.js --schema public --output src/repository/entities
   ```

### CLI Options

The entity generator supports the following command-line options:

| Option | Description |
|--------|-------------|
| `--table <name>` | Generate entity for specific table |
| `--schema <name>` | Generate entities for all tables in schema (default: public) |
| `--output, -o <path>` | Output directory for generated files (default: ./src/entities) |
| `--base-class <name>` | Base class for entities (default: Entity) |
| `--overwrite` | Overwrite existing files |
| `--no-relationships` | Skip relationship generation |
| `--help, -h` | Show help message |

**Examples:**

```bash
# Generate entity for 'session' table
node dist/utils/entityGenerator.js --table session

# Generate all entities in public schema with overwrite
node dist/utils/entityGenerator.js --schema public --output ./generated --overwrite

# Generate entity with custom base class
node dist/utils/entityGenerator.js --table users --base-class BaseModel

# Generate without relationships
node dist/utils/entityGenerator.js --table logs --no-relationships
```

### Example Usage

Generate an entity for the `ai_agent_session` table:

```bash
node dist/utils/entityGenerator.js --table ai_agent_session --output src/repository/entities
```

This creates a file `src/repository/entities/ai-agent-session.ts` with:
- Complete entity class extending `Entity`
- Repository class extending `AbstractRepository`
- Proper annotations and type mappings
- Constructor with object destructuring
- Getter methods with decorators
- Repository registration

### Generated Output Example

For a table like:
```sql
CREATE TABLE ai_agent_session (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    user_login VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    ping TIMESTAMP
);
```

The generator produces:

```typescript
import { AbstractRepository, Entity } from "../abstractRepository";
import { Column } from "../annotations/Column";
import { Find } from "../annotations/find";
import { Id } from "../annotations/Id";
import { repository } from "../repository";

export class AiAgentSession extends Entity {
   private id?: number;
   private name: string;
   private userLogin: string;
   private createdAt?: Date;
   private ping?: Date;

   constructor({ id, name, userLogin, createdAt, ping }: { 
      id?: number, 
      name: string, 
      userLogin: string, 
      createdAt?: Date, 
      ping?: Date 
   }) {
      super();
      this.id = id;
      this.name = name;
      this.userLogin = userLogin;
      this.createdAt = createdAt;
      this.ping = ping;
   }

   @Id('id')
   public getId(): number | undefined {
      return this.id;
   }

   @Column({ columnName: 'name', notNull: true })
   public getName(): string {
      return this.name;
   }

   @Column({ columnName: 'user_login', notNull: true })
   public getUserLogin(): string {
      return this.userLogin;
   }

   @Column({ columnName: 'created_at' })
   public getCreatedAt(): Date | undefined {
      return this.createdAt;
   }

   @Column({ columnName: 'ping' })
   public getPing(): Date | undefined {
      return this.ping;
   }

   public setPing(ping?: Date) {
      this.ping = ping;
   }
}

export class AiAgentSessionRepository extends AbstractRepository<AiAgentSession> {
   constructor() {
      super('ai_agent_session', AiAgentSession);
   }

   @Find()
   public async findByUserLogin(userLogin: string): Promise<AiAgentSession | null> {
      return null;
   }
}

const aiAgentSessionRepository = new AiAgentSessionRepository();
repository.set(AiAgentSession, aiAgentSessionRepository);
export default aiAgentSessionRepository;
```

## Manual Entity Creation

### 1. Create the Entity File

Create a new file in `src/repository/entities/` following the naming convention:

```typescript
// src/repository/entities/myEntity.ts
import { AbstractRepository, Entity } from "../abstractRepository";
import { Column } from "../annotations/Column";
import { Find } from "../annotations/find";
import { Id } from "../annotations/Id";
import { repository } from "../repository";
```

### 2. Define the Entity Class

```typescript
export class MyEntity extends Entity {
   // Private fields matching database columns
   private id?: number;
   private name: string;
   private email: string;
   private createdAt?: Date;

   // Constructor with object destructuring
   constructor({ id, name, email, createdAt }: { 
      id?: number, 
      name: string, 
      email: string, 
      createdAt?: Date 
   }) {
      super(); // Always call super() first
      this.id = id;
      this.name = name;
      this.email = email;
      this.createdAt = createdAt;
   }

   // Annotated getter methods
   @Id('id')
   public getId(): number | undefined {
      return this.id;
   }

   @Column({ columnName: 'name', notNull: true })
   public getName(): string {
      return this.name;
   }

   @Column({ columnName: 'email', notNull: true, unique: true })
   public getEmail(): string {
      return this.email;
   }

   @Column({ columnName: 'created_at' })
   public getCreatedAt(): Date | undefined {
      return this.createdAt;
   }

   // Setter methods for mutable fields
   public setEmail(email: string) {
      this.email = email;
   }
}
```

### 3. Create the Repository Class

```typescript
export class MyEntityRepository extends AbstractRepository<MyEntity> {
   constructor() {
      super('my_table_name', MyEntity); // table name, entity class
   }

   @Find()
   public async findByEmail(email: string): Promise<MyEntity | null> {
      // Implementation provided by @Find() decorator
      return null;
   }

   @Find()
   public async findByName(name: string): Promise<MyEntity | null> {
      return null;
   }
}
```

### 4. Register the Repository

```typescript
const myEntityRepository = new MyEntityRepository();
repository.set(MyEntity, myEntityRepository);
export default myEntityRepository;
```

## Entity Structure Overview

### Required Components

1. **Imports**: Always include the core imports
2. **Entity Class**: Extends `Entity` base class
3. **Private Fields**: Match database column structure
4. **Constructor**: Object destructuring with proper typing
5. **Getter Methods**: Decorated with `@Id` or `@Column`
6. **Repository Class**: Extends `AbstractRepository<T>`
7. **Repository Registration**: Register with the repository container

### Field Types

| Database Type | TypeScript Type | Example |
|---------------|-----------------|---------|
| INTEGER, SERIAL | `number` | `id?: number` |
| VARCHAR, TEXT | `string` | `name: string` |
| BOOLEAN | `boolean` | `isActive: boolean` |
| TIMESTAMP, DATE | `Date` | `createdAt?: Date` |
| JSON, JSONB | `any` | `metadata?: any` |

### Optional vs Required Fields

- **Optional**: Primary keys, nullable columns, columns with defaults
- **Required**: Non-null columns without defaults

```typescript
private id?: number;           // Optional (primary key)
private name: string;          // Required (not null, no default)
private createdAt?: Date;      // Optional (has default value)
private isActive?: boolean;    // Optional (nullable)
```

## Annotations Reference

### @Id Annotation

Used for primary key columns:

```typescript
@Id('column_name')
public getId(): number | undefined {
   return this.id;
}
```

### @Column Annotation

Used for regular columns with options:

```typescript
// Basic column
@Column({ columnName: 'name' })
public getName(): string {
   return this.name;
}

// Column with constraints
@Column({ columnName: 'email', notNull: true, unique: true })
public getEmail(): string {
   return this.email;
}

// Nullable column
@Column({ columnName: 'description' })
public getDescription(): string | undefined {
   return this.description;
}
```

#### @Column Options

- `columnName`: Database column name (required)
- `notNull`: Mark as not nullable (default: false)
- `unique`: Mark as unique constraint (default: false)

### @Find Annotation

Used in repository classes for query methods:

```typescript
@Find()
public async findByEmail(email: string): Promise<MyEntity | null> {
   return null; // Implementation provided by decorator
}
```

## Repository Pattern

### Repository Class Structure

```typescript
export class EntityNameRepository extends AbstractRepository<EntityName> {
   constructor() {
      super('table_name', EntityName);
   }

   // Custom finder methods
   @Find()
   public async findByField(value: any): Promise<EntityName | null> {
      return null;
   }

   // Custom query methods can be added here
   public async customMethod(): Promise<EntityName[]> {
      // Custom implementation
      return [];
   }
}
```

### Repository Registration

Always register your repository:

```typescript
const entityRepository = new EntityNameRepository();
repository.set(EntityName, entityRepository);
export default entityRepository;
```

### Using Repositories

```typescript
import entityRepository from './entities/myEntity';

// Find by ID
const entity = await entityRepository.findById(1);

// Find by custom field
const entity = await entityRepository.findByEmail('user@example.com');

// Save entity
await entityRepository.save(entity);
```

## Best Practices

### 1. Naming Conventions

- **Entity Classes**: PascalCase (`UserAccount`, `OrderItem`)
- **File Names**: camelCase matching class name (`userAccount.ts`)
- **Private Fields**: camelCase (`userName`, `createdAt`)
- **Getter Methods**: `get` + PascalCase (`getUserName`, `getCreatedAt`)

### 2. Constructor Design

Always use object destructuring:

```typescript
// ✅ Good - Object destructuring
constructor({ id, name, email }: { id?: number, name: string, email: string }) {
   super();
   this.id = id;
   this.name = name;
   this.email = email;
}

// ❌ Bad - Positional parameters
constructor(id: number, name: string, email: string) {
   // Don't do this
}
```

### 3. Type Safety

- Use proper optional types for nullable fields
- Always call `super()` first in constructor
- Mark fields as optional only when they truly are

### 4. Repository Methods

- Use `@Find()` for simple finder methods
- Keep custom logic in separate methods
- Always export the repository instance as default

### 5. Field Initialization

```typescript
// ✅ Good - Proper optional handling
private createdAt?: Date;

constructor({ createdAt }: { createdAt?: Date }) {
   super();
   this.createdAt = createdAt; // Can be undefined
}

@Column({ columnName: 'created_at' })
public getCreatedAt(): Date | undefined {
   return this.createdAt;
}
```

## Troubleshooting

### Common Issues

1. **"Property has no initializer" Error**
   - Make sure all non-optional fields are initialized in constructor
   - Use `?` for optional fields that can be undefined

2. **"Cannot find module" Errors**
   - Check import paths are relative and correct
   - Ensure no `.js` extensions in imports

3. **"super() must be called" Error**
   - Always call `super()` first in constructor
   - Don't access `this` before `super()` call

4. **Repository Not Found**
   - Verify repository is registered with `repository.set()`
   - Check the entity class is exported properly

### Debugging Tips

1. **Check Database Connection**
   ```bash
   psql -h localhost -U your_user -d your_database -c "\dt"
   ```

2. **Verify Table Structure**
   ```bash
   psql -h localhost -U your_user -d your_database -c "\d table_name"
   ```

3. **Test Entity Compilation**
   ```bash
   npx tsc --noEmit src/repository/entities/yourEntity.ts
   ```

4. **Run Entity Generator Tests**
   ```bash
   npm run test-entity-generator:dev
   ```

### Generator Troubleshooting

1. **Table Not Found**
   - Verify table exists: `\dt` in psql
   - Check table name spelling and case

2. **Permission Errors**
   - Ensure database user has read access to system catalogs
   ```sql
   GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO your_user;
   GRANT SELECT ON ALL TABLES IN SCHEMA pg_catalog TO your_user;
   ```

3. **Type Mapping Issues**
   - Check PostgreSQL version compatibility (12+)
   - Custom types may map to `any`

## Testing Your Entities

### 1. Compilation Test
```bash
npm run build
```

### 2. Entity Generator Test
```bash
npm run test-entity-generator:dev
```

### 3. Manual Testing
```typescript
import { AiAgentSession } from './entities/aiAgentSession';

// Create new instance
const session = new AiAgentSession({
   name: 'Test Session',
   userLogin: 'test_user'
});

// Test getters
console.log(session.getName()); // "Test Session"
console.log(session.getUserLogin()); // "test_user"
```

## Summary

The entity creation process involves either using the automated generator for quick setup or manually creating entities following the established patterns. The key is to maintain consistency with:

- Proper imports and inheritance
- Object destructuring constructors
- Method-based annotations
- Repository pattern implementation
- Type safety and optional handling

For most use cases, the automated generator provides the fastest and most consistent approach to creating entities that follow all project conventions.