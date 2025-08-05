import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { ValidationError } from './errors';
import Logger from './logger';

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validateRequest(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        Logger.warn(`Validation failed: ${message}`);
        next(new ValidationError(message));
      } else {
        next(error);
      }
    }
  };
}

// Common validation schemas
export const commonSchemas = {
  id: z.object({
    id: z.string().regex(/^\d+$/).transform(Number)
  }),
  
  pagination: z.object({
    page: z.string().optional().transform(val => val ? Number(val) : 1),
    limit: z.string().optional().transform(val => val ? Number(val) : 10)
  }),
  
  sessionCreate: z.object({
    name: z.string().min(1).max(100),
    username: z.string().min(1).max(50)
  }),
  
  questionRequest: z.object({
    question: z.string().min(1).max(1000)
  })
};