import ReflectMetadata from "../../utils/reflectMetadata";
import { camelCase } from "../../utils/string";
import { GET_PREFIX } from "../abstractRepository";

export const __fieldColumn__ = 'fieldColumns';
export const __columnFields__ = 'columnFields';
export const __uniqueColumns__ = 'uniqueColumns';
export const __notNullColumns__ = 'notNullColumns';

export function Column({ columnName, unique, notNull }: {
   columnName?: string;
   unique?: boolean;
   notNull?: boolean;
}) {
   return function (target: any, propertyKey?: string, descriptor?: TypedPropertyDescriptor<any>) {
      if (propertyKey?.startsWith(GET_PREFIX) && (propertyKey.length > GET_PREFIX.length)) {
         const fieldName = camelCase(propertyKey.substring(GET_PREFIX.length));

         const finalColumnName = columnName ?? fieldName;

         if(unique) {
            const uniqueColumns = ReflectMetadata.getMetadata(__uniqueColumns__, target) ?? new Set<string>();
            uniqueColumns.add(finalColumnName);
            ReflectMetadata.defineMetadata(__uniqueColumns__, uniqueColumns, target);
         }

         if(notNull) {
            const notNullColumns = ReflectMetadata.getMetadata(__notNullColumns__, target) ?? new Set<string>();
            notNullColumns.add(finalColumnName);
            ReflectMetadata.defineMetadata(__notNullColumns__, notNullColumns, target);
         }

         const fieldColumns = ReflectMetadata.getMetadata(__fieldColumn__, target) ?? {} as Record<string, string>;
         fieldColumns[fieldName] = finalColumnName;
         ReflectMetadata.defineMetadata(__fieldColumn__, fieldColumns, target);

         const columnFields = ReflectMetadata.getMetadata(__columnFields__, target) ?? {} as Record<string, string>;
         columnFields[finalColumnName] = fieldName;
         ReflectMetadata.defineMetadata(__columnFields__, columnFields, target);
      }
   };
}