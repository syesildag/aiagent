# Releases

## [1.1.0] - 2026-03-10

### Added
- Release system with version tooltip on agent name in chat interface
- `GET /version` API endpoint exposing current release notes
- Markdown-based changelog parsed server-side

### Changed
- Agent AppBar now shows version badge and release notes on hover

---

## [1.0.0] - 2026-01-01

### Added
- Initial release
- Multi-agent chat interface (general, weather)
- MCP server orchestration with tool approval workflow
- PostgreSQL-backed conversation history
- PWA support with service worker
- OpenAI, Ollama, and GitHub Copilot LLM providers
- Embedding service with pgvector similarity search
- Dark/light mode toggle
- File attachment with image compression
- Streaming NDJSON responses
- Background job scheduler with `AgentJob`
- Slash commands and skills system
