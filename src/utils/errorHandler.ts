import { Request, Response, NextFunction } from 'express';
import { AppError } from './errors';
import Logger from './logger';
import { isProduction } from './config';

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction) {
  Logger.error(`Error: ${error.message}${error.stack ? `\nStack: ${error.stack}` : ''}`);

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      status: 'error',
      message: error.message,
      ...(isProduction() ? {} : { stack: error.stack })
    });
  }

  // Handle unknown errors
  res.status(500).json({
    status: 'error',
    message: isProduction() ? 'Internal server error' : error.message,
    ...(isProduction() ? {} : { stack: error.stack })
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    status: 'error',
    message: 'Resource not found'
  });
}