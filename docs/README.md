# AI Agent Documentation

## Entity Development

- **[Entity Creation Guide](ENTITY_CREATION_GUIDE.md)**: Complete guide for creating TypeScript entities from PostgreSQL tables
- **[Entity Quick Reference](ENTITY_QUICK_REFERENCE.md)**: Quick reference for entity patterns and CLI commands

## Project Information

- **[Main README](../README.md)**: Project overview, setup, and API documentation
- **[Development Guide](../AGENTS.md)**: Code style, testing, and development guidelines
- **[Entity Generator Documentation](../ENTITY_GENERATOR.md)**: Detailed generator documentation

## Quick Links

### Entity Generator Commands
```bash
# Single table
node dist/utils/entityGeneratorCLI.js --table table_name --output src/repository/entities

# Entire schema
node dist/utils/entityGeneratorCLI.js --schema public --output src/repository/entities
```

### Development Commands
```bash
npm run build              # Build TypeScript
npm test                   # Run tests
npm run dev               # Development mode
npm start                 # Production mode
```

### Entity Testing
```bash
npm run test-entity-generator:dev    # Test entity generator
npx tsc --noEmit path/to/entity.ts   # Check entity compilation
```