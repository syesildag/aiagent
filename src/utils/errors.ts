export class AppError extends Error {
   public readonly statusCode: number;
   public readonly isOperational: boolean;

   constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
      super(message);
      this.statusCode = statusCode;
      this.isOperational = isOperational;
      
      Error.captureStackTrace(this, this.constructor);
   }
}

export class ValidationError extends AppError {
   constructor(message: string) {
      super(message, 400);
   }
}

export class DatabaseError extends AppError {
   constructor(message: string) {
      super(`Database Error: ${message}`, 500);
   }
}

export class ExternalServiceError extends AppError {
   constructor(service: string, message: string) {
      super(`${service} Error: ${message}`, 502);
   }
}