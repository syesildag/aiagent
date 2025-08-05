# AI Agent Development Guide

## Build & Test Commands
- `npm run build` - Clean and compile TypeScript
- `npm test` - Run all Jest tests
- `npm start` - Run production build
- `npm run dev` - Run development build
- To run single test file: `jest src/path/to/test.file.test.ts`

## Environment Configuration
- Use `.env.example` as template for environment variables
- All environment variables are validated with Zod schemas in `config.ts`
- Config is centralized in `src/utils/config.ts` - import from there, not `process.env`

## Code Style Guidelines
- Use TypeScript with strict mode enabled
- Import statements: relative imports with proper paths, external deps first
- Naming: camelCase for variables/functions, PascalCase for classes/interfaces
- Use abstract classes and decorators (@Id, @Column, @Find) for entities
- Error handling: Use custom error classes (AppError, ValidationError, DatabaseError)
- Use Logger from `src/utils/logger.ts` instead of console.log/error
- Async/await preferred over promises
- Private class members with getters/setters pattern
- Mark unused parameters with underscore prefix (_param)

## Project Structure
- `src/agents/` - Agent implementations extending AbstractAgent
- `src/repository/` - Database entities with decorators and repositories
- `src/utils/` - Utility functions and shared services
- `src/descriptions/` - Type definitions and schemas

## Testing
- Use Jest with ts-jest preset
- Test files end with `.test.ts`
- Tests in same directory as source files
- Mock external dependencies properly
- All tests should pass before committing

## Input Validation
- Use validation middleware from `src/utils/validation.ts`
- Common schemas available in `commonSchemas`
- Always validate API inputs with Zod schemas