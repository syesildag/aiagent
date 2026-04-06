---
name: code-standards
description: Coding standards for the aiagent project — TypeScript, naming, error handling, testing, and security conventions
metadata:
  tags: [code, coding, standards, typescript, naming, style, conventions, review, lint, testing, security]
---

# Code Standards Skill

This skill defines the coding standards for the aiagent project. Apply these when reviewing or writing code.

## TypeScript

- Strict mode is enabled — every value must be properly typed; avoid `any`.
- Use `unknown` instead of `any` when the type is genuinely unknown, and narrow with type guards.
- Prefer `const` over `let`; never use `var`.
- Async/await over Promise chains.
- Private class fields with getters/setters.
- Mark unused parameters with `_` prefix (e.g. `_param`).

## Naming Conventions

| Construct | Convention |
|-----------|-----------|
| Variables / functions | `camelCase` |
| Classes / interfaces / types | `PascalCase` |
| Constants | `UPPER_SNAKE_CASE` |
| File names | `kebab-case.ts` |

## Error Handling

- Use custom error classes: `AppError`, `ValidationError`, `DatabaseError`.
- Never swallow errors silently — always log at the appropriate level.
- Use `Logger` from `src/utils/logger.ts` instead of `console.log/error`.

## Repository / Entity Pattern

- Entities extend `Entity<PK>` and annotate getters with `@Id`, `@Column`, `@OneToOne`, etc.
- Each entity file creates and registers its own `AbstractRepository` subclass.
- Use `@Find` decorator to auto-generate find methods for unique columns.

## Testing

- Test files end with `.test.ts` and live next to the source file.
- Mock all external dependencies (database, network, LLM providers).
- All tests must pass before committing (`npm test`).

## Security

- Validate all inputs with Zod schemas.
- Never expose secrets or API keys in logs or responses.
- Sanitise user-controlled values before using in shell commands or SQL.
