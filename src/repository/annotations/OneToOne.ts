import ReflectMetadata from "../../utils/reflectMetadata";
import { GET_PREFIX } from "../abstractRepository";

export const __oneToOneRelations__ = 'oneToOneRelations';

export interface OneToOneOptions {
  /**
   * The target entity class for this relationship
   */
  target: () => Function;
  
  /**
   * The foreign key column name in this entity that references the target entity
   */
  joinColumn?: string;
  
  /**
   * Whether to cascade save operations to the related entity
   */
  cascadeSave?: boolean;
  
  /**
   * Whether to cascade delete operations to the related entity
   */
  cascadeDelete?: boolean;
  
  /**
   * Whether to load the relationship lazily (default: false)
   */
  lazy?: boolean;
}

export interface OneToOneMetadata extends OneToOneOptions {
  fieldName: string;
  propertyKey: string;
}

/**
 * @OneToOne decorator for defining one-to-one relationships between entities
 * 
 * @param options Configuration options for the relationship
 * 
 * @example
 * ```typescript
 * @OneToOne({
 *   target: () => Profile,
 *   joinColumn: 'profile_id',
 *   cascadeSave: true,
 *   cascadeDelete: false,
 *   lazy: false
 * })
 * public getProfile(): Profile | undefined {
 *   return this.profile;
 * }
 * ```
 */
export function OneToOne(options: OneToOneOptions) {
  return function (target: any, propertyKey?: string, descriptor?: TypedPropertyDescriptor<any>) {
    if (!propertyKey?.startsWith(GET_PREFIX) || propertyKey.length <= GET_PREFIX.length) {
      throw new Error('@OneToOne decorator can only be applied to getter methods starting with "get"');
    }

    const fieldName = propertyKey.substring(GET_PREFIX.length).toLowerCase();
    
    // Set default values
    const metadata: OneToOneMetadata = {
      fieldName,
      propertyKey,
      target: options.target,
      joinColumn: options.joinColumn || `${fieldName}_id`,
      cascadeSave: options.cascadeSave || false,
      cascadeDelete: options.cascadeDelete || false,
      lazy: options.lazy || false
    };

    // Store metadata
    const existingRelations = ReflectMetadata.getMetadata(__oneToOneRelations__, target) || new Map<string, OneToOneMetadata>();
    existingRelations.set(fieldName, metadata);
    ReflectMetadata.setMetadata(__oneToOneRelations__, existingRelations, target);

    return descriptor;
  };
}