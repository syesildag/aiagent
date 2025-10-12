/**
 * String case conversion utilities
 * Centralized functions for converting between different naming conventions
 */

/**
 * Convert snake_case to PascalCase
 * e.g., "user_profile" -> "UserProfile", "created_at" -> "CreatedAt"
 */
export function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Convert snake_case to camelCase
 * e.g., "user_profile" -> "userProfile", "created_at" -> "createdAt"
 */
export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Convert PascalCase or camelCase to snake_case
 * e.g., "UserProfile" -> "user_profile", "createdAt" -> "created_at"
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Convert snake_case to kebab-case
 * e.g., "user_profile" -> "user-profile"
 */
export function toKebabCase(str: string): string {
  return str.replace(/_/g, '-').toLowerCase();
}

/**
 * Convert kebab-case to snake_case
 * e.g., "user-profile" -> "user_profile"
 */
export function kebabToSnake(str: string): string {
  return str.replace(/-/g, '_');
}

/**
 * Capitalize the first letter of a string
 * e.g., "hello" -> "Hello"
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert the first letter to lowercase
 * e.g., "Hello" -> "hello"
 */
export function uncapitalize(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}