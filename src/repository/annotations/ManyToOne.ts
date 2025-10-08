import ReflectMetadata from "../../utils/reflectMetadata";
import { GET_PREFIX } from "../abstractRepository";

export const __manyToOneRelations__ = 'manyToOneRelations';

export interface ManyToOneOptions {
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
   * Whether to load the relationship lazily (default: true)
   */
  lazy?: boolean;
}

export interface ManyToOneMetadata extends ManyToOneOptions {
  fieldName: string;
  propertyKey: string;
}

/**
 * @ManyToOne decorator for defining many-to-one relationships between entities
 * 
 * @param options Configuration options for the relationship
 * 
 * @example
 * ```typescript
 * @ManyToOne({
 *   target: () => Category,
 *   joinColumn: 'category_id',
 *   cascadeSave: false,
 *   cascadeDelete: false,
 *   lazy: true
 * })
 * public getCategory(): Category | undefined {
 *   return this.category;
 * }
 * ```
 */
export function ManyToOne(options: Partial<ManyToOneOptions> = {}) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const fieldName = propertyKey.replace(GET_PREFIX, '');
    
    // Get existing metadata or initialize empty array
    const existingMetadata: ManyToOneMetadata[] = 
      ReflectMetadata.getMetadata(__manyToOneRelations__, target.constructor) || [];
    
    // Add new metadata
    const newMetadata: ManyToOneMetadata = {
      fieldName,
      propertyKey,
      target: options.target || (() => Object),
      joinColumn: options.joinColumn || fieldName + '_id',
      cascadeSave: options.cascadeSave || false,
      cascadeDelete: options.cascadeDelete || false,
      lazy: options.lazy !== undefined ? options.lazy : true
    };
    
    existingMetadata.push(newMetadata);
    
    // Store updated metadata
    ReflectMetadata.setMetadata(__manyToOneRelations__, existingMetadata, target.constructor);
  };
}

/**
 * Get all ManyToOne relationship metadata for an entity class
 */
export function getManyToOneRelations<T>(entityClass: new (...args: any[]) => T): ManyToOneMetadata[] {
  return ReflectMetadata.getMetadata(__manyToOneRelations__, entityClass) || [];
}