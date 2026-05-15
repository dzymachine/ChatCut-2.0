# F005: MCP Event Bridge (Live Edits)

> **Status:** planned
> **Target:** Phase 2 (post 2026-05-15)
> **Last touched:** 2026-05-11

## Summary

Allow external MCP clients (Claude Desktop, Cursor) to drive the **live** in-memory editor state while the app is running, instead of only operating on the saved `.chatcut` file.

## Origin

Sprint plan §"Architecture" (`docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md:74`) — "Phase 2 promotes the Rust server to broker live edits via an event bridge."

ADR-0004 (`docs/kb/decisions/0004-internal-chat-bypasses-mcp.md`) documents the current split.

## Requirements (placeholder)

1. **Tauri event bridge:** Rust MCP handler sends mutation commands to the webview via Tauri events. Webview executes them against the Zustand store and replies with the result.
2. **Correlation IDs:** Each MCP request gets a unique ID. The webview response includes the same ID so Rust can match request to response.
3. **Timeouts:** If the webview doesn't respond within N seconds (e.g. 10s), the MCP tool returns an error to the external client.
4. **State sync:** After a mutation, the MCP server can observe the updated state by querying the webview (not re-reading the file).
5. **Conflict resolution:** If both internal chat and external MCP mutate simultaneously, the Zustand store handles it (last-write-wins within the single-threaded JS event loop).

## Current state

- Internal chat: `agent/loop.ts` → `tool-registry.ts` → `editor-store.ts` (Zustand, in-memory)
- External MCP: `mcp/mod.rs` → `project/reader.rs` → `.chatcut` file on disk
- Lock file in `lib.rs` detects running instances but is not PID-validated

## Dependencies

- Tauri event system (`tauri::Manager::emit`, `tauri::listen` on webview side)
- Serializable command/response types shared between Rust and TS
- Changes to `mcp/mod.rs` tool handlers to dispatch via events instead of direct file I/O when app is running
