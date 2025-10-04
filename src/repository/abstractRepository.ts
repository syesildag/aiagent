import { queryDatabase } from "../utils/pgClient";
import ReflectMetadata from "../utils/reflectMetadata";
import { __columnFields__, __fieldColumn__, __notNullColumns__, __uniqueColumns__ } from "./annotations/Column";
import { __id__ } from "./annotations/Id";
import { __oneToManyRelations__, OneToManyMetadata } from "./annotations/OneToMany";
import { __oneToOneRelations__, OneToOneMetadata } from "./annotations/OneToOne";
import { LazyLoadingUtils } from "./lazyLoading";
import { repository } from "./repository";
import { Table } from "./table";

export abstract class Entity {
   abstract getId(): number | undefined;
   public save<T extends Entity>(this: T): Promise<T | undefined> {
      const repo = repository.get(this.constructor as Constructor<Entity>);
      return repo?.save(this) as Promise<T | undefined>;
   }
   public async delete(): Promise<void> {
      const repo = repository.get(this.constructor as Constructor<Entity>);
      if (repo) {
         await repo.delete(this);
      }
   }
}

export interface Constructor<T, A extends any[] = any[]> {
   new(...args: A): T;
}

export const GET_PREFIX = 'get';
export const SET_PREFIX = 'set';

export abstract class AbstractRepository<C extends Entity> {

   private idColumnName: string;
   private fieldColumnNames: Record<string, string>;
   private columnFieldNames: Record<string, string>;
   private uniqueColumnSet: Set<string>;
   private notNullColumnSet: Set<string>;
   private uniqueColumns: Array<string>;
   private notNullColumns: Array<string>;
   private oneToOneRelations: Map<string, OneToOneMetadata>;
   private oneToManyRelations: Map<string, OneToManyMetadata>;

   constructor(protected table: Table, protected clazz: Constructor<C>) {
      this.idColumnName = ReflectMetadata.getMetadata(__id__, clazz.prototype) ?? 'id';
      this.fieldColumnNames = ReflectMetadata.getMetadata(__fieldColumn__, clazz.prototype) ?? {};
      this.columnFieldNames = ReflectMetadata.getMetadata(__columnFields__, clazz.prototype) ?? {};
      this.uniqueColumnSet = ReflectMetadata.getMetadata(__uniqueColumns__, clazz.prototype) ?? new Set<string>();
      this.notNullColumnSet = ReflectMetadata.getMetadata(__notNullColumns__, clazz.prototype) ?? new Set<string>();
      this.uniqueColumns = Array.from(this.uniqueColumnSet);
      this.notNullColumns = Array.from(this.notNullColumnSet);
      this.oneToOneRelations = ReflectMetadata.getMetadata(__oneToOneRelations__, clazz.prototype) || new Map<string, OneToOneMetadata>();
      this.oneToManyRelations = ReflectMetadata.getMetadata(__oneToManyRelations__, clazz.prototype) || new Map<string, OneToManyMetadata>();
   }

   public getColumnName(fieldName: string) {
      return this.fieldColumnNames[fieldName];
   }

   public getFieldName(columnName: string) {
      return { ...this.columnFieldNames, [this.idColumnName]: __id__ }[columnName];
   }

   public getUniqueColumns() {
      return this.uniqueColumns as ReadonlyArray<string>;
   }

   public getNotNullColumns() {
      return this.notNullColumns as ReadonlyArray<string>;
   }

   /**
    * Get OneToOne relationship metadata
    */
   public getOneToOneRelations() {
      return this.oneToOneRelations;
   }

   /**
    * Get OneToMany relationship metadata
    */
   public getOneToManyRelations() {
      return this.oneToManyRelations;
   }

   private async createEntity(row: any): Promise<C | null> {
      const parameters = Object.keys(row).reduce((acc: any, columnName: string) => {
         const fieldName = this.getFieldName(columnName);
         if (!fieldName)
            throw new Error(`No field name found for column name: ${columnName}`);
         acc[fieldName] = row[columnName];
         return acc;
      }, {});
      
      const entity = new this.clazz(parameters);
      await this.loadRelationships(entity, row);
      return entity;
   }

   /**
    * Load relationships for an entity (eager or lazy)
    */
   private async loadRelationships(entity: C, row: any): Promise<void> {
      // Load OneToOne relationships
      for (const [fieldName, metadata] of this.oneToOneRelations) {
         const foreignKeyValue = row[metadata.joinColumn!];
         
         if (foreignKeyValue !== null && foreignKeyValue !== undefined) {
            if (metadata.lazy) {
               // Create lazy loading proxy
               const proxy = LazyLoadingUtils.createSingleProxy(async () => {
                  const targetRepository = repository.get(metadata.target() as Constructor<Entity>);
                  if (!targetRepository) {
                     throw new Error(`No repository found for target entity: ${metadata.target().name}`);
                  }
                  return await targetRepository.getById(foreignKeyValue);
               });
               (entity as any)[fieldName] = proxy;
            } else {
               // Eager loading
               const targetRepository = repository.get(metadata.target() as Constructor<Entity>);
               if (targetRepository) {
                  (entity as any)[fieldName] = await targetRepository.getById(foreignKeyValue);
               }
            }
         } else {
            (entity as any)[fieldName] = metadata.lazy ? 
               LazyLoadingUtils.createSingleProxy(async () => null) : null;
         }
      }

      // Load OneToMany relationships
      for (const [fieldName, metadata] of this.oneToManyRelations) {
         const entityId = entity.getId();
         
         if (entityId !== null && entityId !== undefined) {
            if (metadata.lazy) {
               // Create lazy loading proxy for collection
               const proxy = LazyLoadingUtils.createCollectionProxy(async () => {
                  const targetRepository = repository.get(metadata.target() as Constructor<Entity>);
                  if (!targetRepository) {
                     throw new Error(`No repository found for target entity: ${metadata.target().name}`);
                  }
                  const results = await targetRepository.getByColumnValues({ [metadata.mappedBy!]: entityId });
                  return results || [];
               });
               (entity as any)[fieldName] = proxy;
            } else {
               // Eager loading
               const targetRepository = repository.get(metadata.target() as Constructor<Entity>);
               if (targetRepository) {
                  const results = await targetRepository.getByColumnValues({ [metadata.mappedBy!]: entityId });
                  (entity as any)[fieldName] = results || [];
               }
            }
         } else {
            (entity as any)[fieldName] = metadata.lazy ? 
               LazyLoadingUtils.createCollectionProxy(async () => []) : [];
         }
      }
   }

   public async getByUniqueValues(...uniqueValues: any[]): Promise<C | null> {
      const record = Object.fromEntries(this.getUniqueColumns().map((columnName, index) => [columnName, uniqueValues[index]]));
      const result = await this.getByColumnValues(record, true);
      return result && result.length > 0 ? result[0] : null;
   }

   public async getByFieldValues(fieldValues: Record<string, any>): Promise<C[] | null> {
      const columnValues = Object.fromEntries(Object.entries(fieldValues).map(([fieldName, value]) => [this.getColumnName(fieldName), value]));
      return this.getByColumnValues(columnValues);
   }

   public async save(entity: C): Promise<C> {
      // Handle cascade save operations first
      await this.handleCascadeSave(entity);

      const columns = Object.keys(this.columnFieldNames).filter(column => this.notNullColumnSet.has(column) || (entity as any)[this.getFieldName(column)] !== undefined);
      const values = columns.map(column => (entity as any)[this.getFieldName(column)]);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

      const updateAssignments = columns.map(column => `${column} = EXCLUDED.${column}`).join(', ');

      const sqlQuery = `
         INSERT INTO ${this.table} (${columns.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT (${this.getUniqueColumns().join(', ')})
         DO UPDATE SET ${updateAssignments}
         RETURNING *
      `;

      const rows = await queryDatabase(sqlQuery, values);
      if (rows.length === 0)
         throw new Error('Failed to upsert entity');

      const savedEntity = await this.createEntity(rows[0]);
      if (!savedEntity) {
         throw new Error('Failed to create entity after save');
      }
      return savedEntity;
   }

   /**
    * Handle cascade save operations for relationships
    */
   private async handleCascadeSave(entity: C): Promise<void> {
      // Handle OneToOne cascade saves
      for (const [fieldName, metadata] of this.oneToOneRelations) {
         if (metadata.cascadeSave) {
            const relationValue = (entity as any)[fieldName];
            if (relationValue) {
               const actualValue = await LazyLoadingUtils.getValue(relationValue);
               if (actualValue && actualValue.save) {
                  await actualValue.save();
               }
            }
         }
      }

      // Handle OneToMany cascade saves
      for (const [fieldName, metadata] of this.oneToManyRelations) {
         if (metadata.cascadeSave) {
            const relationValue = (entity as any)[fieldName];
            if (relationValue) {
               const actualValue = await LazyLoadingUtils.getValue(relationValue);
               if (Array.isArray(actualValue)) {
                  for (const relatedEntity of actualValue) {
                     if (relatedEntity && relatedEntity.save) {
                        await relatedEntity.save();
                     }
                  }
               }
            }
         }
      }
   }

   public async getByColumnValues(columnValues: Record<string, any>, unique?: boolean): Promise<C[] | null> {
      const sqlQuery = `
            SELECT *
              FROM ${this.table}
             WHERE ${Object.keys(columnValues).map((columnName, index) => `${columnName} = $${index + 1}`).join(' AND ')}
         `;
      const rows = await queryDatabase(sqlQuery, Object.values(columnValues));
      if (rows.length === 0)
         return null;

      if(unique && rows.length > 1)
         throw new Error('Multiple rows found for unique query');

      const entities = await Promise.all(rows.map((row: any) => this.createEntity(row)));
      return entities.filter(e => e !== null) as C[];
   }

   public async getById(id: number): Promise<C | null> {
      const sqlQuery = `
            SELECT *
              FROM ${this.table}
             WHERE ${this.idColumnName} = $1
         `;
      const rows = await queryDatabase(sqlQuery, [id]);
      if (rows.length === 0)
         return null;
      return await this.createEntity(rows[0]);
   }

   public async findAll(): Promise<C[]> {
      const sqlQuery = `
            SELECT *
              FROM ${this.table}
         `;
      const rows = await queryDatabase(sqlQuery);
      const entities = await Promise.all(rows.map((row: any) => this.createEntity(row)));
      return entities.filter(e => e !== null) as C[];
   }

   public async delete(entity: C): Promise<void> {
      const id = entity.getId();
      if (id === undefined) {
         throw new Error('Cannot delete entity without ID');
      }

      // Handle cascade delete operations first
      await this.handleCascadeDelete(entity);
      
      const sqlQuery = `
         DELETE FROM ${this.table}
         WHERE ${this.idColumnName} = $1
      `;
      
      await queryDatabase(sqlQuery, [id]);
   }

   /**
    * Handle cascade delete operations for relationships
    */
   private async handleCascadeDelete(entity: C): Promise<void> {
      // Handle OneToOne cascade deletes
      for (const [fieldName, metadata] of this.oneToOneRelations) {
         if (metadata.cascadeDelete) {
            const relationValue = (entity as any)[fieldName];
            if (relationValue) {
               const actualValue = await LazyLoadingUtils.getValue(relationValue);
               if (actualValue && actualValue.delete) {
                  await actualValue.delete();
               }
            }
         }
      }

      // Handle OneToMany cascade deletes
      for (const [fieldName, metadata] of this.oneToManyRelations) {
         if (metadata.cascadeDelete) {
            const relationValue = (entity as any)[fieldName];
            if (relationValue) {
               const actualValue = await LazyLoadingUtils.getValue(relationValue);
               if (Array.isArray(actualValue)) {
                  for (const relatedEntity of actualValue) {
                     if (relatedEntity && relatedEntity.delete) {
                        await relatedEntity.delete();
                     }
                  }
               }
            }
         }
      }
   }

   public async deleteAll() {
      const sqlQuery = `DELETE FROM ${this.table}`;
      await queryDatabase(sqlQuery);
   }

   /**
      TRUNCATE TABLE: Removes all rows from the table more efficiently than DELETE
      RESTART IDENTITY: Resets any auto-increment/serial columns back to their starting value
      CASCADE: Automatically truncates tables that have foreign key references to this table

      The key differences between deleteAll() and truncate():

      Performance: TRUNCATE is generally faster for large tables
      Identity reset: TRUNCATE resets auto-increment counters, DELETE doesn't
      Triggers: TRUNCATE doesn't fire row-level triggers, DELETE does
      Transaction log: TRUNCATE generates less transaction log data
      Foreign keys: TRUNCATE with CASCADE handles foreign key constraints automatically
    */
   public async truncate() {
      const sqlQuery = `TRUNCATE TABLE ${this.table} RESTART IDENTITY CASCADE`;
      await queryDatabase(sqlQuery);
   }
}