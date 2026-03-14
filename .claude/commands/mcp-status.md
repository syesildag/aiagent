---
description: Show MCP tools cache status (servers, cached tools, cache validity)
disable-model-invocation: true
fresh-context: true
---

!`curl -s http://localhost:${PORT}/mcp-status 2>/dev/null || curl -sk https://localhost:${PORT}/mcp-status 2>/dev/null || echo "Error: could not reach server on port ${PORT}"`
