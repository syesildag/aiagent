import ReflectMetadata from "../../utils/reflectMetadata";
import { GET_PREFIX } from "../abstractRepository";

export const __id__ = 'id';

export function Id(columnName: string = __id__) {
   return function (target: any, propertyKey?: string | symbol, descriptor?: TypedPropertyDescriptor<any> | any) {
      const methodName = typeof propertyKey === 'string' ? propertyKey : propertyKey?.toString() || '';
      if (methodName === GET_PREFIX + 'Id')
         ReflectMetadata.setMetadata(__id__, columnName, target);
      else throw new Error('Id decorator must be used on getId method');
      return descriptor;
   };
}
