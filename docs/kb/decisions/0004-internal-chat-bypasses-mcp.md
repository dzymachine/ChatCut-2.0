# ADR-0004: Internal Chat Bypasses MCP (Direct Zustand Mutation)

> **Status:** Accepted
> **Date:** 2026-05-01
> **Decided in:** `docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md` (Decision #1)

## Context

Two options for the agent loop: (A) route chat through the Rust MCP server, so internal and external paths are identical, or (B) have the in-app chat call Zustand actions directly, while external clients go through MCP.

Option A required building a request/response-over-Tauri-events bridge with correlation IDs and timeouts — estimated to consume the entire sprint.

## Decision

Internal chat mutates the Zustand store directly via `tool-registry.ts`. The Rust MCP server (`mcp/mod.rs`) serves **only** external clients (Claude Desktop, Cursor, CLIs). Both paths read from the same `tools.json` schema.

```
Internal (webview):  agent/loop.ts  -->  tool-registry.ts  -->  editor-store.ts (Zustand)
External (MCP):      MCP client  -->  mcp/mod.rs  -->  project/reader.rs  -->  .chatcut file on disk
```

Phase 2 will add an event bridge so external MCP clients can drive the live in-memory store when the app is running.

## Consequences

- Internal edits happen in memory (fast, no serialization overhead). External edits operate on the saved project file (slower, requires save/reload to see changes in app).
- The two paths can drift: a Zustand action might behave differently from its MCP counterpart. `tools.json` mitigates this but doesn't eliminate it.
- Phase 2 event bridge is explicitly deferred — not forgotten. The data model already supports it.
