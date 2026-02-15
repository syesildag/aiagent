import { camelCase, words, upperCase, toUpper, toLower, upperFirst } from './string';

describe('String Utilities', () => {
  describe('words', () => {
    it('should split camelCase into words', () => {
      expect(words('camelCase')).toEqual(['camel', 'Case']);
    });

    it('should split PascalCase into words', () => {
      expect(words('PascalCase')).toEqual(['Pascal', 'Case']);
    });

    it('should split snake_case into words', () => {
      expect(words('snake_case')).toEqual(['snake', 'case']);
    });

    it('should split kebab-case into words', () => {
      expect(words('kebab-case')).toEqual(['kebab', 'case']);
    });

    it('should handle numbers in strings', () => {
      expect(words('test123')).toEqual(['test', '123']);
    });

    it('should handle empty string', () => {
      expect(words('')).toEqual([]);
    });

    it('should handle string with spaces', () => {
      expect(words('hello world')).toEqual(['hello', 'world']);
    });

    it('should use custom pattern when provided', () => {
      expect(words('hello-world', /\w+/g)).toEqual(['hello', 'world']);
      expect(words('hello-world-test', /\w+/g)).toEqual(['hello', 'world', 'test']);
    });

    it('should handle uppercase acronyms', () => {
      expect(words('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request']);
    });
  });

  describe('camelCase', () => {
    it('should convert PascalCase to camelCase', () => {
      expect(camelCase('PascalCase')).toBe('pascalCase');
    });

    it('should convert snake_case to camelCase', () => {
      expect(camelCase('snake_case')).toBe('snakeCase');
    });

    it('should convert kebab-case to camelCase', () => {
      expect(camelCase('kebab-case')).toBe('kebabCase');
    });

    it('should convert space separated words to camelCase', () => {
      expect(camelCase('hello world')).toBe('helloWorld');
    });

    it('should handle empty string', () => {
      expect(camelCase('')).toBe('');
    });

    it('should handle strings with numbers', () => {
      expect(camelCase('test123Case')).toBe('test123Case');
    });

    it('should handle already camelCase strings', () => {
      expect(camelCase('camelCase')).toBe('camelCase');
    });
  });

  describe('upperCase', () => {
    it('should convert camelCase to UPPER CASE', () => {
      expect(upperCase('camelCase')).toBe('CAMEL CASE');
    });

    it('should convert PascalCase to UPPER CASE', () => {
      expect(upperCase('PascalCase')).toBe('PASCAL CASE');
    });

    it('should convert snake_case to UPPER CASE', () => {
      expect(upperCase('snake_case')).toBe('SNAKE CASE');
    });

    it('should handle empty string', () => {
      expect(upperCase('')).toBe('');
    });

    it('should handle single word', () => {
      expect(upperCase('hello')).toBe('HELLO');
    });
  });

  describe('toUpper', () => {
    it('should convert lowercase to uppercase', () => {
      expect(toUpper('hello')).toBe('HELLO');
    });

    it('should handle already uppercase', () => {
      expect(toUpper('HELLO')).toBe('HELLO');
    });

    it('should handle mixed case', () => {
      expect(toUpper('HeLLo')).toBe('HELLO');
    });

    it('should handle empty string', () => {
      expect(toUpper('')).toBe('');
    });
  });

  describe('toLower', () => {
    it('should convert uppercase to lowercase', () => {
      expect(toLower('HELLO')).toBe('hello');
    });

    it('should handle already lowercase', () => {
      expect(toLower('hello')).toBe('hello');
    });

    it('should handle mixed case', () => {
      expect(toLower('HeLLo')).toBe('hello');
    });

    it('should handle empty string', () => {
      expect(toLower('')).toBe('');
    });
  });

  describe('upperFirst', () => {
    it('should capitalize first letter', () => {
      expect(upperFirst('hello')).toBe('Hello');
    });

    it('should handle already capitalized', () => {
      expect(upperFirst('Hello')).toBe('Hello');
    });

    it('should handle all uppercase', () => {
      expect(upperFirst('HELLO')).toBe('HELLO');
    });

    it('should handle single character', () => {
      expect(upperFirst('h')).toBe('H');
    });

    it('should handle empty string', () => {
      expect(upperFirst('')).toBe('');
    });
  });
});
