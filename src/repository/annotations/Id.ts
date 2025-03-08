import ReflectMetadata from "../../utils/reflectMetadata";
import { GET_PREFIX } from "../abstractRepository";

export const __id__ = 'id';

export function Id(columnName: string = __id__) {
   return function (target: any, propertyKey?: string, descriptor?: TypedPropertyDescriptor<any>) {
      if (propertyKey === GET_PREFIX + 'Id')
         ReflectMetadata.defineMetadata(__id__, columnName, target);
      else throw new Error('Id decorator must be used on getId method');
   };
}
