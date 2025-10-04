# Enhanced Repository Pattern

## Overview

The repository pattern has been enhanced to support complex queries with ordering, filtering, and pagination. This eliminates the need for direct SQL queries in most cases while maintaining type safety and clean code.

## Key Enhancements

### 1. Method-Based Ordering

The `@Find` decorator now supports method names with ordering clauses:

```typescript
// Before: Direct SQL
const result = await queryDatabase("SELECT * FROM ai_agent_memories WHERE type = $1 ORDER BY created_at DESC", [memoryType]);

// After: Repository method
const result = await aiagentmemoriesRepository.findByTypeOrderByCreatedAtDesc(memoryType);
```

### 2. Flexible Base Methods

Enhanced `getByFieldValues` and `findAll` methods with options:

```typescript
// Find with ordering and pagination
const memories = await aiagentmemoriesRepository.getByFieldValues(
  { type: 'conversation' },
  { 
    orderBy: [{ field: 'createdAt', direction: 'DESC' }],
    limit: 10,
    offset: 0
  }
);

// Find all with ordering
const allMemories = await aiagentmemoriesRepository.findAll({
  orderBy: [{ field: 'createdAt', direction: 'DESC' }],
  limit: 50
});
```

### 3. Automatic Method Generation

The entity generator now automatically creates repository methods:

```typescript
export class AiAgentMemoriesRepository extends AbstractRepository<AiAgentMemories> {
  @Find()
  public async findByTypeOrderByCreatedAtDesc(type: string): Promise<AiAgentMemories[] | null> {
    return null; // Implementation handled by @Find decorator
  }

  @Find()
  public async findByType(type: string): Promise<AiAgentMemories[] | null> {
    return null; // Implementation handled by @Find decorator
  }

  @Find()
  public async findAllOrderByCreatedAtDesc(): Promise<AiAgentMemories[]> {
    return []; // Implementation handled by @Find decorator
  }
}
```

## Method Naming Conventions

The enhanced `@Find` decorator parses method names with the following pattern:

- `findBy{Field}` - Simple field filtering
- `findBy{Field}And{Field2}` - Multiple field filtering  
- `findBy{Field}OrderBy{OrderField}Desc` - Field filtering with descending order
- `findBy{Field}OrderBy{OrderField}Asc` - Field filtering with ascending order
- `findAllOrderBy{OrderField}Desc` - All records with descending order

## Examples

### Memory Server Usage

```typescript
// Before: Direct SQL in memory server
const result = await queryDatabase("SELECT * FROM ai_agent_memories WHERE type = $1 ORDER BY created_at DESC", [memoryType]);

// After: Repository pattern
const memories = await aiagentmemoriesRepository.findByTypeOrderByCreatedAtDesc(memoryType);
const result = memories?.map(memory => ({
  id: memory.getId(),
  type: memory.getType(),
  content: memory.getContent(),
  source: memory.getSource(),
  tags: memory.getTags(),
  confidence: memory.getConfidence(),
  created_at: memory.getCreatedat(),
  updated_at: memory.getUpdatedat()
})) || [];
```

### Complex Filtering

```typescript
// Simple type filtering with ordering
const typeMemories = await aiagentmemoriesRepository.findByTypeOrderByCreatedAtDesc('knowledge');

// Multiple criteria with ordering
const specificMemories = await aiagentmemoriesRepository.findByTypeAndConfidenceOrderByCreatedAtDesc('knowledge', 0.9);

// All memories with pagination
const recentMemories = await aiagentmemoriesRepository.findAll({
  orderBy: [{ field: 'createdAt', direction: 'DESC' }],
  limit: 20,
  offset: 0
});
```

## Hybrid Approach

For complex operations like vector similarity search, we maintain a hybrid approach:

- **Repository Pattern**: Used for CRUD operations, simple filtering, and ordering
- **Direct SQL**: Preserved for complex database-specific operations like vector similarity

```typescript
// Repository pattern for CRUD
const memory = new AiAgentMemories({...});
await memory.save();

// Direct SQL for vector operations (performance-critical)
const sqlQuery = `
  SELECT *, 1 - (embedding <=> $1::vector) as similarity
  FROM ai_agent_memories
  WHERE type = $2
  ORDER BY similarity DESC
  LIMIT $3
`;
```

## Benefits

1. **Type Safety**: Full TypeScript support with entity types
2. **Code Clarity**: Readable method names instead of SQL strings
3. **Consistency**: Uniform data access patterns across the application
4. **Maintainability**: Centralized query logic in repository classes
5. **Performance**: Optimized for common operations while preserving complex SQL when needed
6. **Auto-generation**: Automatic creation of finder methods based on entity structure

## Migration Status

- ✅ User management (login, addUser scripts)
- ✅ Memory management (MCP server CRUD operations)
- ✅ Complex queries with ordering and filtering
- ✅ Hybrid approach for vector operations
- ✅ All tests passing (64 tests)

The enhanced repository pattern provides a clean, type-safe abstraction while maintaining the flexibility to use direct SQL for complex database operations when needed.