import { camelCase } from "../../utils/string";
import { AbstractRepository, Entity } from "../abstractRepository";

const findBy = 'findBy';
const findAll = 'findAll';
const orderBy = 'OrderBy';

export function Find(fromCache?: boolean) {
   return function (target: any, propertyKey?: string | symbol, descriptor?: TypedPropertyDescriptor<any> | any) {

      const originalMethod = descriptor?.value;

      if (typeof originalMethod !== 'function')
         throw new Error(`@Find decorator can only be applied to methods, not ${typeof originalMethod}`);

      if (!originalMethod.name.startsWith(findBy) && !originalMethod.name.startsWith(findAll))
         throw new Error(`@Find decorator can only be applied to method names starting with findBy or findAll, not ${originalMethod.name}`);

      if (!(target instanceof AbstractRepository))
         throw new Error(`@Find decorator can only be applied to methods of AbstractRepository subclasses, not ${target}`);

      const methodName = (originalMethod as Function).name;
      let fieldsPart: string;
      let orderByClause: { field: string; direction: 'ASC' | 'DESC' }[] = [];
      
      // Determine the field part based on method name pattern
      if (methodName.startsWith(findBy)) {
         fieldsPart = methodName.substring(findBy.length);
      } else if (methodName.startsWith(findAll)) {
         fieldsPart = methodName.substring(findAll.length);
      } else {
         fieldsPart = '';
      }

      // Check if the method name contains OrderBy
      if (fieldsPart.includes(orderBy)) {
         const parts = fieldsPart.split(orderBy);
         fieldsPart = parts[0];
         const orderPart = parts[1];
         
         if (orderPart) {
            // Parse order by clause (e.g., "CreatedAtDesc" -> { field: "createdAt", direction: "DESC" })
            const orderFields = orderPart.split('And');
            orderByClause = orderFields.map(orderField => {
               let direction: 'ASC' | 'DESC' = 'ASC';
               let field = orderField;
               
               if (orderField.endsWith('Desc')) {
                  direction = 'DESC';
                  field = orderField.substring(0, orderField.length - 4);
               } else if (orderField.endsWith('Asc')) {
                  direction = 'ASC';
                  field = orderField.substring(0, orderField.length - 3);
               }
               
               return { field: camelCase(field), direction };
            });
         }
      }

      const fieldNames = fieldsPart ? fieldsPart.split('And').map(fieldName => camelCase(fieldName)) : [];

      descriptor!.value = async function (...args: any[]) {
         const fieldValues: Record<string, any> = {};
         fieldNames.forEach((fieldName, index) => fieldValues[fieldName] = args[index]);
         
         const options = orderByClause.length > 0 ? { orderBy: orderByClause } : undefined;
         
         if (Object.keys(fieldValues).length === 0) {
            // If no field filters, use findAll with options
            return (this as AbstractRepository<Entity>).findAll(options);
         } else {
            return (this as AbstractRepository<Entity>).getByFieldValues(fieldValues, options);
         }
      };

      return descriptor;
   };
}