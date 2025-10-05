import ReflectMetadata from "../../utils/reflectMetadata";

export const __defaultColumns__ = 'defaultColumns';

/**
 * Decorator to mark a column as having a database default value.
 * This prevents the repository from including the column in INSERT statements
 * when the entity field value is undefined, allowing the database to use its default.
 */
export function Default() {
   return function (target: any, propertyKey?: string | symbol, descriptor?: TypedPropertyDescriptor<any> | any) {
      const methodName = typeof propertyKey === 'string' ? propertyKey : propertyKey?.toString() || '';
      if (methodName?.startsWith('get') && (methodName.length > 3)) {
         // Extract field name from getter method
         const fieldName = methodName.charAt(3).toLowerCase() + methodName.slice(4);
         
         const defaultColumns = ReflectMetadata.getMetadata(__defaultColumns__, target) ?? new Set<string>();
         defaultColumns.add(fieldName);
         ReflectMetadata.setMetadata(__defaultColumns__, defaultColumns, target);
      }
      return descriptor;
   };
}