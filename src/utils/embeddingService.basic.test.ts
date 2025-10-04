/**
 * Basic functionality tests for the Embedding Service
 */

import { getEmbeddings } from './embeddingService';

describe('EmbeddingService Basic Tests', () => {
  describe('Backward compatibility', () => {
    it('should export getEmbeddings function', () => {
      expect(typeof getEmbeddings).toBe('function');
    });

    it('should have correct function signature', () => {
      expect(getEmbeddings.length).toBe(2); // accepts text and optional options
    });
  });

  describe('Error handling', () => {
    it('should throw error for empty string', async () => {
      await expect(getEmbeddings('')).rejects.toThrow();
    });

    it('should throw error for whitespace only string', async () => {
      await expect(getEmbeddings('   ')).rejects.toThrow();
    });
  });
});