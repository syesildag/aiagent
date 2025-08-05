import { validateRequest, commonSchemas } from './validation';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from './errors';
import { z } from 'zod';

// Mock the logger
jest.mock('./logger', () => ({
  warn: jest.fn()
}));

describe('Validation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = { body: {}, query: {}, params: {} };
    mockRes = {};
    mockNext = jest.fn();
  });

  describe('validateRequest', () => {
    test('should pass valid body data', () => {
      const schema = z.object({ name: z.string() });
      const middleware = validateRequest({ body: schema });
      
      mockReq.body = { name: 'test' };
      middleware(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });

    test('should reject invalid body data', () => {
      const schema = z.object({ name: z.string() });
      const middleware = validateRequest({ body: schema });
      
      mockReq.body = { name: 123 };
      middleware(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    test('should validate query parameters', () => {
      const middleware = validateRequest({ query: commonSchemas.pagination });
      
      mockReq.query = { page: '2', limit: '20' };
      middleware(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockReq.query).toEqual({ page: 2, limit: 20 });
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('commonSchemas', () => {
    test('should validate ID parameter', () => {
      const result = commonSchemas.id.parse({ id: '123' });
      expect(result).toEqual({ id: 123 });
    });

    test('should validate session creation data', () => {
      const data = { name: 'test session', username: 'testuser' };
      const result = commonSchemas.sessionCreate.parse(data);
      expect(result).toEqual(data);
    });

    test('should reject invalid session data', () => {
      const data = { name: '', username: 'testuser' };
      expect(() => commonSchemas.sessionCreate.parse(data)).toThrow();
    });
  });
});