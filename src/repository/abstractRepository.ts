import { queryDatabase } from "../utils/pgClient";
import ReflectMetadata from "../utils/reflectMetadata";
import { toCamelCase } from "../utils/stringCase";
import { __columnFields__, __fieldColumn__, __notNullColumns__, __uniqueColumns__, __defaultColumns__ } from "./annotations/Column";
import { __id__ } from "./annotations/Id";
import { __oneToManyRelations__, OneToManyMetadata } from "./annotations/OneToMany";
import { __oneToOneRelations__, OneToOneMetadata } from "./annotations/OneToOne";
import { LazyLoadingUtils } from "./lazyLoading";
import { repository } from "./repository";
import { Table } from "./table";
import { PrimaryKey } from "./serializable";

export abstract class Entity<T extends PrimaryKey = number> {
   abstract getId(): T | undefined;
   public save<E extends Entity<T>>(this: E): Promise<E | undefined> {
      const repo = repository.get(this.constructor as Constructor<Entity<any>>);
      return repo?.save(this) as Promise<E | undefined>;
   }
   public async delete(): Promise<void> {
      const repo = repository.get(this.constructor as Constructor<Entity<any>>);
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

export abstract class AbstractRepository<C extends Entity<any>> {

   private idColumnName: string;
   private fieldColumnNames: Record<string, string>;
   private columnFieldNames: Record<string, string>;
   private uniqueColumnSet: Set<string>;
   private notNullColumnSet: Set<string>;
   private defaultColumnSet: Set<string>;
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
      this.defaultColumnSet = ReflectMetadata.getMetadata(__defaultColumns__, clazz.prototype) ?? new Set<string>();
      this.uniqueColumns = Array.from(this.uniqueColumnSet);
      this.notNullColumns = Array.from(this.notNullColumnSet);
      this.oneToOneRelations = ReflectMetadata.getMetadata(__oneToOneRelations__, clazz.prototype) || new Map<string, OneToOneMetadata>();
      this.oneToManyRelations = ReflectMetadata.getMetadata(__oneToManyRelations__, clazz.prototype) || new Map<string, OneToManyMetadata>();
   }

   public getColumnName(fieldName: string) {
      return this.fieldColumnNames[fieldName];
   }

   public getFieldName(columnName: string) {
      // Check if there's an explicit mapping first
      if (this.columnFieldNames[columnName]) {
         return this.columnFieldNames[columnName];
      }
      
      // For ID column, try to find the actual field name
      if (columnName === this.idColumnName) {
         // For non-standard ID columns, derive field name from column name
         // Convert snake_case to camelCase (e.g., 'version' stays 'version', 'user_id' becomes 'userId')
         return toCamelCase(columnName);
      }
      
      return this.columnFieldNames[columnName];
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
                  const targetRepository = repository.get(metadata.target() as Constructor<Entity<any>>);
                  if (!targetRepository) {
                     throw new Error(`No repository found for target entity: ${metadata.target().name}`);
                  }
                  return await targetRepository.getById(foreignKeyValue);
               });
               (entity as any)[fieldName] = proxy;
            } else {
               // Eager loading
               const targetRepository = repository.get(metadata.target() as Constructor<Entity<any>>);
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
                  const targetRepository = repository.get(metadata.target() as Constructor<Entity<any>>);
                  if (!targetRepository) {
                     throw new Error(`No repository found for target entity: ${metadata.target().name}`);
                  }
                  const results = await targetRepository.getByColumnValues({ [metadata.mappedBy!]: entityId });
                  return results || [];
               });
               (entity as any)[fieldName] = proxy;
            } else {
               // Eager loading
               const targetRepository = repository.get(metadata.target() as Constructor<Entity<any>>);
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

   public async getByFieldValues(fieldValues: Record<string, any>, options?: {
      orderBy?: { field: string; direction?: 'ASC' | 'DESC' }[];
      limit?: number;
      offset?: number;
   }): Promise<C[] | null> {
      const columnValues = Object.fromEntries(Object.entries(fieldValues).map(([fieldName, value]) => [this.getColumnName(fieldName), value]));
      return this.getByColumnValues(columnValues, false, options);
   }

   public async save(entity: C): Promise<C> {
      // Handle cascade save operations first
      await this.handleCascadeSave(entity);

      // Get all columns including ID column
      const allColumns = new Set([...Object.keys(this.columnFieldNames), this.idColumnName]);
      
      const columns = Array.from(allColumns).filter(column => {
         const fieldName = this.getFieldName(column);
         const fieldValue = (entity as any)[fieldName];
         
         // Always include fields that have values
         if (fieldValue !== undefined) return true;
         
         // For fields with undefined values:
         // - Include notNull columns that don't have database defaults
         // - Exclude columns that have database defaults (let DB handle them)
         if (this.notNullColumnSet.has(column)) {
            return !this.defaultColumnSet.has(fieldName);
         }
         
         return false;
      });
      const values = columns.map(column => (entity as any)[this.getFieldName(column)]);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

      // Check if this is a new entity (no ID) or existing entity (has ID)
      const idFieldName = this.getFieldName(this.idColumnName);
      const entityId = (entity as any)[idFieldName];
      const isNewEntity = entityId === undefined || entityId === null;

      let sqlQuery: string;

      if (isNewEntity) {
         // For new entities, use simple INSERT
         sqlQuery = `
            INSERT INTO ${this.table} (${columns.join(', ')})
            VALUES (${placeholders})
            RETURNING *
         `;
      } else {
         // For existing entities, use UPSERT with primary key
         // Exclude primary key from update assignments since it cannot be updated
         const updateColumns = columns.filter(column => column !== this.idColumnName);
         const updateAssignments = updateColumns.map(column => `${column} = EXCLUDED.${column}`).join(', ');
         
         // Use unique columns for conflict resolution if they exist, otherwise use primary key
         const conflictColumns = this.uniqueColumns.length > 0 
            ? this.uniqueColumns.join(', ')
            : this.idColumnName;
            
         sqlQuery = `
            INSERT INTO ${this.table} (${columns.join(', ')})
            VALUES (${placeholders})
            ON CONFLICT (${conflictColumns})
            DO UPDATE SET ${updateAssignments}
            RETURNING *
         `;
      }

      const rows = await queryDatabase(sqlQuery, values);
      if (rows.length === 0)
         throw new Error('Failed to save entity');

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

   public async getByColumnValues(columnValues: Record<string, any>, unique?: boolean, options?: {
      orderBy?: { field: string; direction?: 'ASC' | 'DESC' }[];
      limit?: number;
      offset?: number;
   }): Promise<C[] | null> {
      let sqlQuery = `
            SELECT *
              FROM ${this.table}
             WHERE ${Object.keys(columnValues).map((columnName, index) => `${columnName} = $${index + 1}`).join(' AND ')}
         `;
      
      const queryParams = [...Object.values(columnValues)];
      let paramIndex = queryParams.length;
      
      // Add ORDER BY clause if specified
      if (options?.orderBy && options.orderBy.length > 0) {
         const orderClauses = options.orderBy.map(order => {
            const columnName = this.getColumnName(order.field) || order.field;
            const direction = order.direction || 'ASC';
            return `${columnName} ${direction}`;
         });
         sqlQuery += ` ORDER BY ${orderClauses.join(', ')}`;
      }
      
      // Add LIMIT clause if specified
      if (options?.limit) {
         sqlQuery += ` LIMIT $${++paramIndex}`;
         queryParams.push(options.limit);
      }
      
      // Add OFFSET clause if specified
      if (options?.offset) {
         sqlQuery += ` OFFSET $${++paramIndex}`;
         queryParams.push(options.offset);
      }
      
      const rows = await queryDatabase(sqlQuery, queryParams);
      if (rows.length === 0)
         return null;

      if(unique && rows.length > 1)
         throw new Error('Multiple rows found for unique query');

      const entities = await Promise.all(rows.map((row: any) => this.createEntity(row)));
      return entities.filter(e => e !== null) as C[];
   }

   public async getById(id: PrimaryKey): Promise<C | null> {
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

   public async findAll(options?: {
      where?: Record<string, any>;
      orderBy?: { field: string; direction?: 'ASC' | 'DESC' }[];
      limit?: number;
      offset?: number;
   }): Promise<C[]> {
      let sqlQuery = `
            SELECT *
              FROM ${this.table}
         `;
      
      const queryParams: any[] = [];
      let paramIndex = 0;
      
      // Add WHERE clause if filtering is specified
      if (options?.where && Object.keys(options.where).length > 0) {
         const whereConditions = Object.entries(options.where).map(([fieldName, value]) => {
            const columnName = this.getColumnName(fieldName) || fieldName;
            return `${columnName} = $${++paramIndex}`;
         });
         sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
         queryParams.push(...Object.values(options.where));
      }
      
      // Add ORDER BY clause if specified
      if (options?.orderBy && options.orderBy.length > 0) {
         const orderClauses = options.orderBy.map(order => {
            const columnName = this.getColumnName(order.field) || order.field;
            const direction = order.direction || 'ASC';
            return `${columnName} ${direction}`;
         });
         sqlQuery += ` ORDER BY ${orderClauses.join(', ')}`;
      }
      
      // Add LIMIT clause if specified
      if (options?.limit) {
         sqlQuery += ` LIMIT $${++paramIndex}`;
         queryParams.push(options.limit);
      }
      
      // Add OFFSET clause if specified
      if (options?.offset) {
         sqlQuery += ` OFFSET $${++paramIndex}`;
         queryParams.push(options.offset);
      }
      
      const rows = await queryDatabase(sqlQuery, queryParams);
      const entities = await Promise.all(rows.map((row: any) => this.createEntity(row)));
      return entities.filter(e => e !== null) as C[];
   }

   public async deleteById(id: PrimaryKey): Promise<void> {
      const entity = await this.getById(id);
      if (entity)
         return this.delete(entity);
      throw new Error(`Entity with ID ${id} not found`);
   }

   public async delete(entity: C): Promise<void> {
      const id = entity.getId();
      if (id === undefined || id === null) {
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