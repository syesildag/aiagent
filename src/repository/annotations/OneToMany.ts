import ReflectMetadata from "../../utils/reflectMetadata";
import { GET_PREFIX } from "../abstractRepository";

export const __oneToManyRelations__ = 'oneToManyRelations';

export interface OneToManyOptions {
  /**
   * The target entity class for this relationship
   */
  target: () => Function;
  
  /**
   * The foreign key column name in the target entity that references this entity
   */
  mappedBy?: string;
  
  /**
   * Whether to cascade save operations to the related entities
   */
  cascadeSave?: boolean;
  
  /**
   * Whether to cascade delete operations to the related entities
   */
  cascadeDelete?: boolean;
  
  /**
   * Whether to load the relationship lazily (default: true for performance)
   */
  lazy?: boolean;
}

export interface OneToManyMetadata extends OneToManyOptions {
  fieldName: string;
  propertyKey: string;
}

/**
 * @OneToMany decorator for defining one-to-many relationships between entities
 * 
 * @param options Configuration options for the relationship
 * 
 * @example
 * ```typescript
 * @OneToMany({
 *   target: () => Order,
 *   mappedBy: 'customer_id',
 *   cascadeSave: true,
 *   cascadeDelete: true,
 *   lazy: true
 * })
 * public getOrders(): Order[] | undefined {
 *   return this.orders;
 * }
 * ```
 */
export function OneToMany(options: OneToManyOptions) {
  return function (target: any, propertyKey?: string, descriptor?: TypedPropertyDescriptor<any>) {
    if (!propertyKey?.startsWith(GET_PREFIX) || propertyKey.length <= GET_PREFIX.length) {
      throw new Error('@OneToMany decorator can only be applied to getter methods starting with "get"');
    }

    const fieldName = propertyKey.substring(GET_PREFIX.length).toLowerCase();
    
    // Set default values
    const metadata: OneToManyMetadata = {
      fieldName,
      propertyKey,
      target: options.target,
      mappedBy: options.mappedBy || `${target.constructor.name.toLowerCase()}_id`,
      cascadeSave: options.cascadeSave || false,
      cascadeDelete: options.cascadeDelete || false,
      lazy: options.lazy !== undefined ? options.lazy : true // Default to lazy for performance
    };

    // Store metadata
    const existingRelations = ReflectMetadata.getMetadata(__oneToManyRelations__, target) || new Map<string, OneToManyMetadata>();
    existingRelations.set(fieldName, metadata);
    ReflectMetadata.setMetadata(__oneToManyRelations__, existingRelations, target);

    return descriptor;
  };
}