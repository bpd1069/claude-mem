# Claude-Mem Commands

This directory previously contained development workflow commands (`/do`, `/make-plan`).

These commands have been removed to maintain separation of concerns. Claude-mem now focuses solely on memory and observations.

## Accessing Memory

Memory is available via MCP tools:

- `mcp__plugin_claude-mem_mcp-search__search` - Search observations by query, date, type
- `mcp__plugin_claude-mem_mcp-search__timeline` - Get context around specific observations
- `mcp__plugin_claude-mem_mcp-search__get_observations` - Fetch full details for filtered IDs

Use the 3-layer workflow for efficient token usage:
1. `search(query)` → Get index with IDs
2. `timeline(anchor=ID)` → Get context around results
3. `get_observations([IDs])` → Fetch full details only for filtered IDs
