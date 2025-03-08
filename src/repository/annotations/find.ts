import { camelCase } from "../../utils/string";
import { AbstractRepository, Entity } from "../abstractRepository";

const findBy = 'findBy';

export function Find(fromCache?: boolean) {
   return function (target: any, propertyKey?: string, descriptor?: TypedPropertyDescriptor<any>) {

      const originalMethod = descriptor?.value;

      if (typeof originalMethod !== 'function')
         throw new Error(`@Find decorator can only be applied to methods, not ${typeof originalMethod}`);

      if (!originalMethod.name.startsWith(findBy))
         throw new Error(`@Find decorator can only be applied to method names starting with findBy, not ${originalMethod.name}`);

      if (!(target instanceof AbstractRepository))
         throw new Error(`@Find decorator can only be applied to methods of AbstractRepository subclasses, not ${target}`);

      const fieldNames = (originalMethod as Function).name.substring(findBy.length).split('And').map(fieldName => camelCase(fieldName));

      descriptor!.value = async function (...args: any[]) {
         const fieldValues: Record<string, any> = {};
         fieldNames.forEach((fieldName, index) => fieldValues[fieldName] = args[index]);
         return (this as AbstractRepository<Entity>).getByFieldValues(fieldValues);
      };

      return descriptor;
   };
}