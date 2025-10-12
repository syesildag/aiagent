/**
 * Serializable interface - similar to Java's Serializable
 * Represents types that can be serialized/deserialized and used as identifiers
 */
export type Serializable = string | number | boolean | null | undefined | Date | 
  { [key: string]: Serializable } | Serializable[];

/**
 * Primary key types that can be used as entity identifiers
 */
export type PrimaryKey = string | number;