# F006: Test Harness

> **Status:** planned
> **Target:** Phase 2 (post 2026-05-15)
> **Last touched:** 2026-05-11

## Summary

Automated test coverage for both TypeScript and Rust. Currently there are **zero tests** in `web/` and zero `#[cfg(test)]` modules in Rust.

## Origin

- `ISSUES.md` §16: "Zero integration coverage"
- Sprint plan §"Acceptance criteria" references 3 specific test targets
- Sprint plan §"Verification" (`docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md:456-459`)

## Test targets (priority order)

### 1. Tool registry unit tests (`web/src/lib/agent/tool-registry.test.ts`)

For each entry in `tools.json`, assert:
- A handler exists in `TOOL_HANDLERS`.
- The handler is callable with valid arguments.
- The corresponding Zustand action is reachable.

### 2. Editor store tests (`web/src/lib/store/editor-store.test.ts`)

- `rollbackToNode()` restores tracks + playback to the snapshot.
- `beginUndoBatch` / `commitUndoBatch` produce exactly one undo entry.
- Undo stack cap at 50 entries.
- Slice independence: project mutations don't modify playback (except documented `removeClip` edge case).

### 3. MCP tool handler tests (`web/src-tauri/src/mcp/tools/*`)

For each tool, test against fixture `.chatcut` files:
- Introspection tools return correct data shape.
- Mutation tools produce valid project state.
- Error cases (missing clip_id, invalid effect_id) return structured errors.

### 4. Recipe system tests

- `compile_recipe()` produces valid FFmpeg filter strings for known recipes.
- `validate_recipe()` catches malformed graphs (cycles, dangling connections).

### 5. Live tool sweep (stretch goal)

Per the reference project (`hetpatel-11/Adobe_Premiere_Pro_MCP`): a harness that calls each tool against a running instance and verifies the result. For ChatCut, this means launching Tauri, loading a test project, and exercising each tool via the MCP interface.

## Dependencies

- **TS:** Need a test runner — Vitest recommended (already in Next.js ecosystem).
- **Rust:** Standard `cargo test` with fixture files.
- **CI:** GitHub Actions workflow for both TS and Rust tests.
