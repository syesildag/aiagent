import { queryDatabase } from "./pgClient";
import ReflectMetadata from "./reflectMetadata";
import { camelCase } from "./string";

export interface Entity {
   getId(): number;
}

export interface Constructor<T, A extends any[] = any[]> {
   new(...args: A): T;
}

const fieldColumnNamesMetadataKey = 'fieldColumnNames';
const columnFieldNamesMetadataKey = 'columnFieldNames';
const idColumnMetadataKey = 'id';

type Table = 'session';

export function Id(columnName?: string) {
   return function (target: any, propertyKey?: string, descriptor?: TypedPropertyDescriptor<any>) {
      if (propertyKey === AbstractRepository.GET_PREFIX + 'Id') {
         const fieldName = camelCase(propertyKey.substring(AbstractRepository.GET_PREFIX.length));
         ReflectMetadata.defineMetadata(idColumnMetadataKey, columnName ?? fieldName, target);
      }
   };
}

export function Column({ columnName }: {
   columnName?: string,
   unique?: boolean,
   notNull?: boolean,
}) {
   return function (target: any, propertyKey?: string, descriptor?: TypedPropertyDescriptor<any>) {
      if (propertyKey?.startsWith(AbstractRepository.GET_PREFIX) && (propertyKey.length > AbstractRepository.GET_PREFIX.length)) {
         const fieldName = camelCase(propertyKey.substring(AbstractRepository.GET_PREFIX.length));

         const finalColumnName = columnName ?? fieldName;

         const fieldColumnNames = ReflectMetadata.getMetadata(fieldColumnNamesMetadataKey, target) ?? {};
         fieldColumnNames[fieldName] = finalColumnName;
         ReflectMetadata.defineMetadata(fieldColumnNamesMetadataKey, fieldColumnNames, target);

         const columnFieldNames = ReflectMetadata.getMetadata(columnFieldNamesMetadataKey, target) ?? {};
         columnFieldNames[finalColumnName] = fieldName;
         ReflectMetadata.defineMetadata(columnFieldNamesMetadataKey, columnFieldNames, target);
      }
   };
}

abstract class AbstractRepository<I extends Entity, C extends I> {

   public static readonly GET_PREFIX = 'get';
   public static readonly SET_PREFIX = 'set';

   private idColumnName: string;
   private fieldColumnNames: Record<string, string>;
   private columnFieldNames: Record<string, string>;
   constructor(protected table: Table, protected clazz: Constructor<C>) {
      this.idColumnName = ReflectMetadata.getMetadata(idColumnMetadataKey, clazz.prototype) ?? 'id';
      this.fieldColumnNames = ReflectMetadata.getMetadata(fieldColumnNamesMetadataKey, clazz.prototype) ?? {};
      this.columnFieldNames = ReflectMetadata.getMetadata(columnFieldNamesMetadataKey, clazz.prototype) ?? {};
   }

   public getColumnNames(): string[] {
      return Object.values(this.fieldColumnNames);
   }

   public getAllFieldColumnNames(): Record<string, string> {
      return {...this.fieldColumnNames, id: this.idColumnName};
   }

   public async findAll(): Promise<I[]> {
      const sqlQuery = `
            SELECT *
              FROM ${this.table}
         `;
      const rows = await queryDatabase(sqlQuery);
      return rows.map((row: any) => {
         return Object.keys(row).reduce((acc: any, columnName: string) => {
            const fieldName = this.getAllFieldColumnNames()[columnName];
            acc[fieldName] = row[columnName];
            return acc;
         }, {});
      });
   }
}

export class Session implements Entity {

   private id: number;
   private name: string;
   private username: string;
   private timestamp: Date;
   private ping: Date;

   constructor({ id, name, username, timestamp, ping }: { id: number, name: string, username: string, timestamp: Date, ping: Date }) {
      this.id = id;
      this.name = name;
      this.username = username;
      this.timestamp = timestamp;
      this.ping = ping;
   }

   @Id('id')
   getId(): number {
      return this.id;
   }

   @Column({ columnName: 'name', notNull: true })
   getName(): string {
      return this.name;
   }

   @Column({ columnName: 'username', notNull: true })
   getUsername(): string {
      return this.username;
   }

   @Column({ columnName: 'timestamp', notNull: true })
   getTimestamp(): Date {
      return this.timestamp;
   }

   @Column({ columnName: 'ping' })
   getPing(): Date {
      return this.ping;
   }
}

class SessionRepository extends AbstractRepository<Entity, Session> {
   constructor() {
      super('session', Session);
   }
}

const sessionRepositoryInstance = new SessionRepository();

export default sessionRepositoryInstance;