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
   return function (target: any, propertyKey?: string | symbol, descriptor?: TypedPropertyDescriptor<any> | any) {
      const methodName = typeof propertyKey === 'string' ? propertyKey : propertyKey?.toString() || '';
      if (methodName?.startsWith(GET_PREFIX) && (methodName.length > GET_PREFIX.length)) {
         const fieldName = camelCase(methodName.substring(GET_PREFIX.length));

         const finalColumnName = columnName ?? fieldName;

         if(unique) {
            const uniqueColumns = ReflectMetadata.getMetadata(__uniqueColumns__, target) ?? new Set<string>();
            uniqueColumns.add(finalColumnName);
            ReflectMetadata.setMetadata(__uniqueColumns__, uniqueColumns, target);
         }

         if(notNull) {
            const notNullColumns = ReflectMetadata.getMetadata(__notNullColumns__, target) ?? new Set<string>();
            notNullColumns.add(finalColumnName);
            ReflectMetadata.setMetadata(__notNullColumns__, notNullColumns, target);
         }

         const fieldColumns = ReflectMetadata.getMetadata(__fieldColumn__, target) ?? {} as Record<string, string>;
         fieldColumns[fieldName] = finalColumnName;
         ReflectMetadata.setMetadata(__fieldColumn__, fieldColumns, target);

         const columnFields = ReflectMetadata.getMetadata(__columnFields__, target) ?? {} as Record<string, string>;
         columnFields[finalColumnName] = fieldName;
         ReflectMetadata.setMetadata(__columnFields__, columnFields, target);
      }
      return descriptor;
   };
}