# ADR-0003: tools.json as Single Schema Source of Truth

> **Status:** Accepted
> **Date:** 2026-05-01
> **Decided in:** `docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md` (Decision #2)

## Context

Before this decision, tool schemas were triplicated: `backend/services/providers/function_schemas.py` (575 LOC, Premiere matchNames), `function_schemas_desktop.py` (534 LOC, desktop IDs), and implicit in `web/src/lib/ai/action-mapper.ts` (300 LOC switch statement). Drift was inevitable and already occurring (`ISSUES.md` §6).

## Decision

One canonical JSON file at `web/src-shared/tools.json` defines every tool with its name, type (introspection/mutation), description, and parameter schema.

- **TypeScript:** Imports JSON directly. Types generated at build time.
- **Rust:** `serde_json::from_str` at compile time into `OnceCell<Vec<ToolDef>>`. rmcp `#[tool]` macros for the MCP surface.
- **Current version:** 1.1.0, 17 tools (8 introspection, 9 mutation).

## Consequences

- Adding a tool starts with editing `tools.json`. TS and Rust pick it up automatically (for TS) or via `serde` (Rust still needs a handler function).
- The `effect_id` enum in `tools.json:118-139` must stay in sync with `lib/effects/registry.ts`. No automated check exists yet.
- Legacy Python schemas (`function_schemas*.py`) are no longer the source of truth. They remain only for the frozen UXP plugin.
- Post-sprint convergence task (`chore/uxp-tauri-schema-convergence`) will regenerate the Python schemas from `tools.json`.
