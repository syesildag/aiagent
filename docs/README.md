# AI Agent Documentation

Welcome to the comprehensive documentation for the AI Agent system. This documentation covers all aspects of the system from setup to deployment.

## Getting Started

- **[Main README](../README.md)**: Project overview, features, and quick start guide
- **[Development Guide](../AGENTS.md)**: Code style guidelines, testing commands, and best practices
- **[Configuration Guide](CONFIGURATION.md)**: Environment variables, provider setup, and configuration options

## Core Systems

### Agent System
- **[Agent System](AGENT_SYSTEM.md)**: Creating custom agents, lifecycle management, and system prompts
- **[MCP Integration](MCP_INTEGRATION.md)**: Model Context Protocol servers, tools, resources, and prompts
- **[LLM Providers](LLM_PROVIDERS.md)**: Ollama, OpenAI, and GitHub Copilot setup and configuration

### Authentication & Security
- **[Authentication](AUTHENTICATION.md)**: Session management, login flow, password hashing, and OAuth
- **[Error Handling](ERROR_HANDLING.md)**: Custom error classes, logging, and debugging

## Development

### Testing & Quality
- **[Testing Guide](TESTING_GUIDE.md)**: Unit tests, integration tests, mocking, and coverage
- **[Deployment Guide](DEPLOYMENT.md)**: Docker, Kubernetes, production setup, and monitoring

### Configuration
- **[Configuration Guide](CONFIGURATION.md)**: Complete environment variable reference and validation

## Database & Repository Pattern

### Entity Development
- **[Entity Creation Guide](ENTITY_CREATION_GUIDE.md)**: Complete guide for creating TypeScript entities from PostgreSQL tables
- **[Entity Quick Reference](ENTITY_QUICK_REFERENCE.md)**: Quick reference for entity patterns and CLI commands
- **[Enhanced Repository Pattern](ENHANCED_REPOSITORY_PATTERN.md)**: Advanced repository features, relationships, and lazy loading

### Database Features
- **[Database Conversation History](DbConversationHistory.md)**: Persistent conversation storage with PostgreSQL
- **[Migration System](Migration-System.md)**: Database schema versioning and migration management
- **[Insert Embeddings Guide](INSERT_EMBEDDINGS_GUIDE.md)**: Guide for inserting vector embeddings into PostgreSQL

## API & Tools

### API Reference
- **[API Reference](API_REFERENCE.md)**: Complete REST API documentation with examples
- **[CLI Guide](CLI_GUIDE.md)**: Interactive command-line interface and automation

### Scripts & Utilities
- **[Scripts Reference](SCRIPTS_REFERENCE.md)**: Database management scripts and custom script development
- **[Embedding Service](EMBEDDING_SERVICE.md)**: Multi-provider embedding generation and similarity search

## Background Processing

- **[Job System](JOB_SYSTEM.md)**: Scheduled jobs with node-schedule and cron patterns
- **[Worker System](WORKER_SYSTEM.md)**: Background processing with worker threads

## Architecture Documents

- **[Time Server Summary](time-server-summary.md)**: Time MCP server overview
- **[Time Server Details](time-server.md)**: Detailed time server implementation
- **[Weather Server](weather-server.md)**: Weather MCP server implementation
- **[Helm Refactor Changes](helm-refactor-changes.md)**: Kubernetes Helm chart updates

## Quick Reference

### Development Commands
```bash
npm run build              # Build TypeScript
npm test                   # Run tests
npm run dev               # Development mode
npm start                 # Production mode
npm run migrate           # Run database migrations
```

### Entity Generator Commands
```bash
# Single table
node dist/utils/entityGenerator.js --table table_name --output src/repository/entities

# Entire schema
node dist/utils/entityGenerator.js --schema public --output src/repository/entities
```

### Docker Commands
```bash
docker-compose up -d       # Start all services
docker-compose logs -f     # View logs
docker-compose down        # Stop services
```

### Database Commands
```bash
npm run migrate            # Run migrations
npm run addUser            # Add new user
npm run insertEmbeddings   # Insert embeddings
```

## Documentation Categories

### For Developers
Start with [Development Guide](../AGENTS.md), [Testing Guide](TESTING_GUIDE.md), and [Entity Creation Guide](ENTITY_CREATION_GUIDE.md).

### For DevOps
See [Deployment Guide](DEPLOYMENT.md), [Configuration Guide](CONFIGURATION.md), and [Error Handling](ERROR_HANDLING.md).

### For API Users
Check [API Reference](API_REFERENCE.md), [CLI Guide](CLI_GUIDE.md), and [Authentication](AUTHENTICATION.md).

### For System Architects
Review [Agent System](AGENT_SYSTEM.md), [MCP Integration](MCP_INTEGRATION.md), and [Enhanced Repository Pattern](ENHANCED_REPOSITORY_PATTERN.md).

## Need Help?

- Check the relevant documentation above
- Review code examples in [examples/](../examples/)
- Run tests: `npm test`
- Enable debug logging: `NODE_ENV=development LOG_LEVEL=debug`

## Contributing

When adding new features, please:
1. Update relevant documentation
2. Add tests (see [Testing Guide](TESTING_GUIDE.md))
3. Follow code style in [Development Guide](../AGENTS.md)
4. Update this README if adding new documentation files