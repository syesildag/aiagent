import * as fs from 'fs';
import * as path from 'path';
import { updateEnvVariable, updateEnvVariables, readEnvVariable } from './envManager';
import Logger from './logger';

// Mock fs module
jest.mock('fs');
jest.mock('./logger');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('EnvManager', () => {
  const originalEnv = process.env;
  const testEnvPath = path.join(process.cwd(), '.env');

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset process.env
    process.env = { ...originalEnv };
    // Default mock implementations
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('');
    mockFs.writeFileSync.mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('updateEnvVariable', () => {
    it('should update existing variable in .env file', () => {
      const existingContent = 'FOO=bar\nBAZ=qux\n';
      mockFs.readFileSync.mockReturnValue(existingContent);

      updateEnvVariable('FOO', 'updated');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        'FOO=updated\nBAZ=qux\n',
        'utf8'
      );
      expect(process.env.FOO).toBe('updated');
    });

    it('should add new variable to .env file', () => {
      const existingContent = 'FOO=bar\n';
      mockFs.readFileSync.mockReturnValue(existingContent);

      updateEnvVariable('NEW_VAR', 'new_value');

      // Check that writeFileSync was called (the exact format might vary)
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        expect.stringContaining('FOO=bar'),
        'utf8'
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        expect.stringContaining('NEW_VAR=new_value'),
        'utf8'
      );
      expect(process.env.NEW_VAR).toBe('new_value');
    });

    it('should handle .env file with spaces around equals', () => {
      const existingContent = 'FOO = bar\nBAZ=qux\n';
      mockFs.readFileSync.mockReturnValue(existingContent);

      updateEnvVariable('FOO', 'updated');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        'FOO=updated\nBAZ=qux\n',
        'utf8'
      );
    });

    it('should create .env file if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockReturnValue('');

      updateEnvVariable('NEW_VAR', 'value');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        expect.stringContaining('NEW_VAR=value'),
        'utf8'
      );
    });

    it('should handle empty values', () => {
      const existingContent = 'FOO=bar\n';
      mockFs.readFileSync.mockReturnValue(existingContent);

      updateEnvVariable('FOO', '');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        'FOO=\n',
        'utf8'
      );
    });

    it('should throw error if file write fails', () => {
      mockFs.readFileSync.mockReturnValue('FOO=bar\n');
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      expect(() => updateEnvVariable('FOO', 'updated')).toThrow('Write failed');
      expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to update .env file'));
    });
  });

  describe('updateEnvVariables', () => {
    it('should update multiple variables at once', () => {
      const existingContent = 'FOO=bar\nBAZ=qux\n';
      mockFs.readFileSync.mockReturnValue(existingContent);

      updateEnvVariables({
        FOO: 'updated_foo',
        BAZ: 'updated_baz',
      });

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        'FOO=updated_foo\nBAZ=updated_baz\n',
        'utf8'
      );
      expect(process.env.FOO).toBe('updated_foo');
      expect(process.env.BAZ).toBe('updated_baz');
    });

    it('should add new variables while updating existing ones', () => {
      const existingContent = 'FOO=bar\n';
      mockFs.readFileSync.mockReturnValue(existingContent);

      updateEnvVariables({
        FOO: 'updated',
        NEW_VAR: 'new',
        ANOTHER: 'another',
      });

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        expect.stringContaining('FOO=updated'),
        'utf8'
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        expect.stringContaining('NEW_VAR=new'),
        'utf8'
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        expect.stringContaining('ANOTHER=another'),
        'utf8'
      );
      expect(process.env.FOO).toBe('updated');
      expect(process.env.NEW_VAR).toBe('new');
      expect(process.env.ANOTHER).toBe('another');
    });

    it('should handle empty updates object', () => {
      const existingContent = 'FOO=bar\n';
      mockFs.readFileSync.mockReturnValue(existingContent);

      updateEnvVariables({});

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        'FOO=bar\n',
        'utf8'
      );
    });

    it('should log appropriate message for single variable', () => {
      mockFs.readFileSync.mockReturnValue('');

      updateEnvVariables({ FOO: 'bar' });

      expect(Logger.info).toHaveBeenCalledWith('Updated FOO in .env file and memory');
    });

    it('should log appropriate message for multiple variables', () => {
      mockFs.readFileSync.mockReturnValue('');

      updateEnvVariables({ FOO: 'bar', BAZ: 'qux' });

      expect(Logger.info).toHaveBeenCalledWith(
        'Updated environment variables: FOO, BAZ in .env file and memory'
      );
    });

    it('should preserve comments and empty lines', () => {
      const existingContent = '# Comment\nFOO=bar\n\nBAZ=qux\n';
      mockFs.readFileSync.mockReturnValue(existingContent);

      updateEnvVariables({ FOO: 'updated' });

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testEnvPath,
        '# Comment\nFOO=updated\n\nBAZ=qux\n',
        'utf8'
      );
    });
  });

  describe('readEnvVariable', () => {
    it('should read existing variable from .env file', () => {
      const content = 'FOO=bar\nBAZ=qux\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('FOO');

      expect(result).toBe('bar');
    });

    it('should return null for non-existent variable', () => {
      const content = 'FOO=bar\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('NONEXISTENT');

      expect(result).toBeNull();
    });

    it('should handle variable with spaces around equals', () => {
      const content = 'FOO = bar with spaces\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('FOO');

      expect(result).toBe('bar with spaces');
    });

    it('should handle empty values', () => {
      const content = 'FOO=\nBAZ=qux\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('FOO');

      expect(result).toBe('');
    });

    it('should return null if .env file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockReturnValue('');

      const result = readEnvVariable('FOO');

      expect(result).toBeNull();
    });

    it('should handle file read errors gracefully', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read failed');
      });

      const result = readEnvVariable('FOO');

      expect(result).toBeNull();
      expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to read .env file'));
    });

    it('should handle multiline values correctly', () => {
      const content = 'FOO=first line\nBAR=second line\nBAZ=third line\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('BAR');

      expect(result).toBe('second line');
    });

    it('should trim whitespace from values', () => {
      const content = 'FOO=  bar  \n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('FOO');

      expect(result).toBe('bar');
    });

    it('should handle values with equals signs', () => {
      const content = 'CONNECTION_STRING=key=value;password=secret\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('CONNECTION_STRING');

      expect(result).toBe('key=value;password=secret');
    });
  });

  describe('Edge cases', () => {
    it('should handle variables with special characters in names', () => {
      const content = 'MY_VAR_123=value\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('MY_VAR_123');

      expect(result).toBe('value');
    });

    it('should handle variables at the start of file without newline', () => {
      const content = 'FOO=bar';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('FOO');

      expect(result).toBe('bar');
    });

    it('should not match partial variable names', () => {
      const content = 'FOO=bar\nFOOBAR=baz\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('FOO');

      expect(result).toBe('bar');
    });

    it('should handle Windows-style line endings', () => {
      const content = 'FOO=bar\r\nBAZ=qux\r\n';
      mockFs.readFileSync.mockReturnValue(content);

      const result = readEnvVariable('BAZ');

      expect(result).toBe('qux');
    });
  });
});
