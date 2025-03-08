import { queryDatabase } from "../utils/pgClient";
import ReflectMetadata from "../utils/reflectMetadata";
import { __columnFields__, __fieldColumn__, __notNullColumns__, __uniqueColumns__ } from "./annotations/Column";
import { __id__ } from "./annotations/Id";
import { registry } from "./registry";
import { Table } from "./table";

export abstract class Entity {
   abstract getId(): number;
   public save() {
      return registry.get(this.constructor as Constructor<Entity>)?.save(this);
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
   private uniqueColumns: Array<string>;
   private notNullColumns: Array<string>;

   constructor(protected table: Table, protected clazz: Constructor<C>) {
      this.idColumnName = ReflectMetadata.getMetadata(__id__, clazz.prototype) ?? 'id';
      this.fieldColumnNames = ReflectMetadata.getMetadata(__fieldColumn__, clazz.prototype) ?? {};
      this.columnFieldNames = ReflectMetadata.getMetadata(__columnFields__, clazz.prototype) ?? {};
      this.uniqueColumns = Array.from(ReflectMetadata.getMetadata(__uniqueColumns__, clazz.prototype) ?? new Set<string>());
      this.notNullColumns = Array.from(ReflectMetadata.getMetadata(__notNullColumns__, clazz.prototype) ?? new Set<string>());
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

   private createEntity(row: any): C | PromiseLike<C | null> | null {
      return Object.keys(row).reduce((acc: any, columnName: string) => {
         const fieldName = this.getFieldName(columnName);
         if (!fieldName)
            throw new Error(`No field name found for column name: ${columnName}`);
         acc[fieldName] = row[columnName];
         return acc;
      }, {});
   }

   public async getByUniqueValues(...uniqueValues: any[]): Promise<C | null> {
      const record = Object.fromEntries(this.getUniqueColumns().map((columnName, index) => [columnName, uniqueValues[index]]));
      return this.getByColumnValues(record);
   }

   public async save(entity: C) {
      const columns = Object.keys(this.columnFieldNames);
      const values = columns.map(column => (entity as any)[this.getFieldName(column)]);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

      const updateAssignments = columns.map((column, index) => `${column} = EXCLUDED.${column}`).join(', ');

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

      return this.createEntity(rows[0]);
   }

   public async getByColumnValues(uniqueValues: Record<string, any>): Promise<C | null> {
      const sqlQuery = `
            SELECT *
              FROM ${this.table}
             WHERE ${Object.keys(uniqueValues).map((columnName, index) => `${columnName} = $${index + 1}`).join(' AND ')}
         `;
      const rows = await queryDatabase(sqlQuery, Object.values(uniqueValues));
      if (rows.length === 0)
         return null;
      return this.createEntity(rows[0]);
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
      return this.createEntity(rows[0]);
   }

   public async findAll() {
      const sqlQuery = `
            SELECT *
              FROM ${this.table}
         `;
      const rows = await queryDatabase(sqlQuery);
      return rows.map((row: any) => this.createEntity(row));
   }
}