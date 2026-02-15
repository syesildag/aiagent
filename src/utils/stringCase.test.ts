import {
  toPascalCase,
  toCamelCase,
  toSnakeCase,
  toKebabCase,
  kebabToSnake,
  capitalize,
  uncapitalize,
} from './stringCase';

describe('StringCase Utilities', () => {
  describe('toPascalCase', () => {
    it('should convert snake_case to PascalCase', () => {
      expect(toPascalCase('user_profile')).toBe('UserProfile');
      expect(toPascalCase('created_at')).toBe('CreatedAt');
      expect(toPascalCase('first_name_last_name')).toBe('FirstNameLastName');
    });

    it('should convert kebab-case to PascalCase', () => {
      expect(toPascalCase('user-profile')).toBe('UserProfile');
      expect(toPascalCase('created-at')).toBe('CreatedAt');
    });

    it('should convert space separated to PascalCase', () => {
      expect(toPascalCase('user profile')).toBe('UserProfile');
      expect(toPascalCase('hello world test')).toBe('HelloWorldTest');
    });

    it('should handle mixed separators', () => {
      expect(toPascalCase('user-profile_name')).toBe('UserProfileName');
      expect(toPascalCase('hello_world-test')).toBe('HelloWorldTest');
    });

    it('should handle already PascalCase', () => {
      expect(toPascalCase('UserProfile')).toBe('Userprofile');
    });

    it('should handle empty string', () => {
      expect(toPascalCase('')).toBe('');
    });

    it('should handle single word', () => {
      expect(toPascalCase('user')).toBe('User');
    });

    it('should handle uppercase words', () => {
      expect(toPascalCase('USER_PROFILE')).toBe('UserProfile');
    });
  });

  describe('toCamelCase', () => {
    it('should convert snake_case to camelCase', () => {
      expect(toCamelCase('user_profile')).toBe('userProfile');
      expect(toCamelCase('created_at')).toBe('createdAt');
      expect(toCamelCase('first_name_last_name')).toBe('firstNameLastName');
    });

    it('should convert kebab-case to camelCase', () => {
      expect(toCamelCase('user-profile')).toBe('userProfile');
      expect(toCamelCase('created-at')).toBe('createdAt');
    });

    it('should convert space separated to camelCase', () => {
      expect(toCamelCase('user profile')).toBe('userProfile');
      expect(toCamelCase('hello world test')).toBe('helloWorldTest');
    });

    it('should handle mixed separators', () => {
      expect(toCamelCase('user-profile_name')).toBe('userProfileName');
    });

    it('should handle already camelCase', () => {
      expect(toCamelCase('userProfile')).toBe('userprofile');
    });

    it('should handle empty string', () => {
      expect(toCamelCase('')).toBe('');
    });

    it('should handle single word', () => {
      expect(toCamelCase('user')).toBe('user');
    });

    it('should handle PascalCase input', () => {
      expect(toCamelCase('UserProfile')).toBe('userprofile');
    });
  });

  describe('toSnakeCase', () => {
    it('should convert PascalCase to snake_case', () => {
      expect(toSnakeCase('UserProfile')).toBe('user_profile');
      expect(toSnakeCase('CreatedAt')).toBe('created_at');
      expect(toSnakeCase('FirstNameLastName')).toBe('first_name_last_name');
    });

    it('should convert camelCase to snake_case', () => {
      expect(toSnakeCase('userProfile')).toBe('user_profile');
      expect(toSnakeCase('createdAt')).toBe('created_at');
    });

    it('should handle consecutive uppercase letters', () => {
      expect(toSnakeCase('XMLHttpRequest')).toBe('x_m_l_http_request');
      expect(toSnakeCase('HTTPSConnection')).toBe('h_t_t_p_s_connection');
    });

    it('should handle already snake_case', () => {
      expect(toSnakeCase('user_profile')).toBe('user_profile');
    });

    it('should handle empty string', () => {
      expect(toSnakeCase('')).toBe('');
    });

    it('should handle single word', () => {
      expect(toSnakeCase('user')).toBe('user');
    });

    it('should handle lowercase input', () => {
      expect(toSnakeCase('userprofile')).toBe('userprofile');
    });
  });

  describe('toKebabCase', () => {
    it('should convert snake_case to kebab-case', () => {
      expect(toKebabCase('user_profile')).toBe('user-profile');
      expect(toKebabCase('created_at')).toBe('created-at');
      expect(toKebabCase('first_name_last_name')).toBe('first-name-last-name');
    });

    it('should handle already lowercase', () => {
      expect(toKebabCase('userprofile')).toBe('userprofile');
    });

    it('should handle mixed case', () => {
      expect(toKebabCase('User_Profile')).toBe('user-profile');
    });

    it('should handle empty string', () => {
      expect(toKebabCase('')).toBe('');
    });

    it('should handle single word', () => {
      expect(toKebabCase('user')).toBe('user');
    });
  });

  describe('kebabToSnake', () => {
    it('should convert kebab-case to snake_case', () => {
      expect(kebabToSnake('user-profile')).toBe('user_profile');
      expect(kebabToSnake('created-at')).toBe('created_at');
      expect(kebabToSnake('first-name-last-name')).toBe('first_name_last_name');
    });

    it('should handle already snake_case', () => {
      expect(kebabToSnake('user_profile')).toBe('user_profile');
    });

    it('should handle mixed separators', () => {
      expect(kebabToSnake('user-profile_name')).toBe('user_profile_name');
    });

    it('should handle empty string', () => {
      expect(kebabToSnake('')).toBe('');
    });

    it('should handle single word', () => {
      expect(kebabToSnake('user')).toBe('user');
    });
  });

  describe('capitalize', () => {
    it('should capitalize the first letter', () => {
      expect(capitalize('hello')).toBe('Hello');
      expect(capitalize('world')).toBe('World');
    });

    it('should handle already capitalized', () => {
      expect(capitalize('Hello')).toBe('Hello');
    });

    it('should handle all uppercase', () => {
      expect(capitalize('HELLO')).toBe('HELLO');
    });

    it('should handle single character', () => {
      expect(capitalize('h')).toBe('H');
    });

    it('should handle empty string', () => {
      expect(capitalize('')).toBe('');
    });

    it('should only capitalize first letter', () => {
      expect(capitalize('hello world')).toBe('Hello world');
    });
  });

  describe('uncapitalize', () => {
    it('should uncapitalize the first letter', () => {
      expect(uncapitalize('Hello')).toBe('hello');
      expect(uncapitalize('World')).toBe('world');
    });

    it('should handle already uncapitalized', () => {
      expect(uncapitalize('hello')).toBe('hello');
    });

    it('should handle all uppercase', () => {
      expect(uncapitalize('HELLO')).toBe('hELLO');
    });

    it('should handle single character', () => {
      expect(uncapitalize('H')).toBe('h');
    });

    it('should handle empty string', () => {
      expect(uncapitalize('')).toBe('');
    });

    it('should only uncapitalize first letter', () => {
      expect(uncapitalize('Hello World')).toBe('hello World');
    });
  });
});
