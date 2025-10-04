# Entity Quick Reference

## Generator Commands

```bash
# Single table
node dist/utils/entityGenerator.js --table table_name --output src/repository/entities

# Entire schema  
node dist/utils/entityGenerator.js --schema public --output src/repository/entities

# Test generator
npm run test-entity-generator:dev
```

## Entity Template

```typescript
import { AbstractRepository, Entity } from "../abstractRepository";
import { Column } from "../annotations/Column";
import { Find } from "../annotations/find";
import { Id } from "../annotations/Id";
import { repository } from "../repository";

export class EntityName extends Entity {
   private id?: number;
   private field: string;
   private optionalField?: string;

   constructor({ id, field, optionalField }: { 
      id?: number, 
      field: string, 
      optionalField?: string 
   }) {
      super();
      this.id = id;
      this.field = field;
      this.optionalField = optionalField;
   }

   @Id('id')
   public getId(): number | undefined {
      return this.id;
   }

   @Column({ columnName: 'field', notNull: true })
   public getField(): string {
      return this.field;
   }

   @Column({ columnName: 'optional_field' })
   public getOptionalField(): string | undefined {
      return this.optionalField;
   }
}

export class EntityNameRepository extends AbstractRepository<EntityName> {
   constructor() {
      super('table_name', EntityName);
   }

   @Find()
   public async findByField(field: string): Promise<EntityName | null> {
      return null;
   }
}

const entityNameRepository = new EntityNameRepository();
repository.set(EntityName, entityNameRepository);
export default entityNameRepository;
```

## Annotations

| Annotation | Usage | Example |
|------------|-------|---------|
| `@Id('column')` | Primary key | `@Id('id')` |
| `@Column({})` | Regular column | `@Column({ columnName: 'name', notNull: true })` |
| `@Find()` | Repository finder | `@Find() async findByEmail(email: string)` |

## Type Mappings

| PostgreSQL | TypeScript |
|------------|------------|
| INTEGER, SERIAL | `number` |
| VARCHAR, TEXT | `string` |
| BOOLEAN | `boolean` |
| TIMESTAMP, DATE | `Date` |
| JSON, JSONB | `any` |

## Common Issues

1. **Constructor**: Always call `super()` first
2. **Types**: Use `?` for optional/nullable fields
3. **Imports**: No `.js` extensions, relative paths
4. **Registration**: Always register repository with `repository.set()`