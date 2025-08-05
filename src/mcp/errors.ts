import { AppError } from "../utils/errors";

export class McpConfigError extends AppError {
   constructor(message: string) {
      super(message, 400);
      this.name = "McpConfigError";
   }
}

export class McpConnectionError extends AppError {
   constructor(message: string) {
      super(message, 500);
      this.name = "McpConnectionError";
   }
}

export class McpServerError extends AppError {
   constructor(message: string) {
      super(message, 500);
      this.name = "McpServerError";
   }
}