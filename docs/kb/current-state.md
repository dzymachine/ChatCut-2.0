# Current State

> **Purpose:** What exists today in the ChatCut codebase, module by module, with code review findings.
> **Last touched:** 2026-05-11
> **Status:** Active

## Overview

ChatCut is a 3-codebase monorepo. Only `web/` is under active development. `backend/` and `plugin/` are frozen per `FREEZE.md` (ends 2026-05-15).

| Codebase | LOC (source) | Language | Status |
|----------|------|----------|--------|
| `web/src/` (TypeScript) | ~5,600 across 56 files | TypeScript, React, Next.js | Active |
| `web/src-tauri/src/` (Rust) | ~4,200 across 19 files | Rust, Tauri, rmcp | Active |
| `web/src-shared/` | ~230 | JSON (schema) | Active |
| `backend/` | ~3,500 | Python, FastAPI | Frozen |
| `plugin/` | ~2,000 | React (UXP), Webpack | Frozen |

## Module-by-module status

### Agent system (`web/src/lib/agent/`)

**What works:**
- Tool-use loop with max 8 iterations (`loop.ts:20`).
- 17 tools registered: 8 introspection + 9 mutation (`tools.json`).
- Three LLM providers: Anthropic (default), Groq, Gemini (`providers/`).
- Per-edit one-line summaries via Haiku (`summarize.ts`).
- Edit history with rollback (`tool-registry.ts` -> `editor-store.ts:editHistory`).

**Known issues:**
- **Tool ID collision risk:** `Date.now()` used for `EditNode.id` generation — two rapid tool calls in the same millisecond collide. Should use `uuid()` or a counter.
- **No state validation:** Tools don't validate pre-conditions (e.g. `trim_clip` doesn't check if clip exists before attempting).
- **Inconsistent error recovery:** Some handlers swallow errors, others throw. No uniform contract for partial failure.
- **Repetitive mutation handler boilerplate:** Each mutation tool in `tool-registry.ts` repeats the same `beginUndoBatch` / store-action / `commitUndoBatch` pattern (~10 lines each). Could be extracted to a wrapper.
- **Inconsistent parameter normalization:** `apply_effect` normalizes params differently from `update_effect_param` (`tool-registry.ts`).
- **Recipe tools return inconsistent shapes:** `compose_recipe` returns `{ success, compiledFilter }` while `validate_recipe` returns `{ valid, filter?, error? }`.

### Editor store (`web/src/lib/store/editor-store.ts`)

**What works:**
- 4 independent slices: playback, project, UI, timeline (`editor-store.ts:7-29`).
- Undo/redo with 50-entry stack cap. Batch operations via `beginUndoBatch` / `commitUndoBatch`.
- `editHistory: EditNode[]` with `rollbackToNode()`.
- Clip linking, splitting, effects, transforms.
- `structuredClone` snapshot before each command (`lib/commands/command-handler.ts:44-45, 97-98`).

**Known issues:**
- **Undo double-bookkeeping:** `toggle-effect` icon creates its own undo entry, so `apply_effect` via the agent produces a duplicate. Cmd+Z first undoes the toggle, then the apply.
- **No schema validation on deserialized state:** `loadProject()` in `serializer.ts` trusts the JSON shape blindly.

### Video engine (`web/src/lib/engine/video-engine.ts`)

**What works:**
- Canvas-based preview rendering.
- Playback with frame scheduling.
- Media loading from File objects and Tauri file paths.

**Known issues:**
- **Large monolith:** ~500 LOC owning preview, caching, and FFmpeg integration. Recent regressions (commit `7f190bd` — audio broke).
- **media-chrome integration fragile:** VideoPreview uses `audio` mode on MediaController to avoid 0x0 collapse; TransportControls needs explicit `display: flex; width: 100%` override on MediaControlBar to prevent `inline-flex` shrink-wrapping.

### Effects system (`web/src/lib/effects/`)

**What works:**
- 20 effects registered across 5 categories: transform (5), color (6), filter (3), transition (3), playback (1) — per `registry.ts`.
- FFmpeg filter mapping in `ffmpeg-mapper.ts`.
- `transform-bridge.ts` bridges CSS transforms for canvas preview.

**Known issues:**
- **No runtime validation** that `tools.json` effect_id enum stays in sync with `registry.ts` effect IDs. Manual maintenance.

### Recipe system (`web/src/lib/recipe/` + `web/src-tauri/src/recipe/`)

**What works:**
- `compose_recipe` tool: users describe FFmpeg filter graphs as JSON nodes + connections.
- `validate_recipe` tool: compiles to FFmpeg filter string, dry-runs via Tauri.
- Rust-side `recipe/validator.rs` runs `ffmpeg -f lavfi` for structural validation.

**Known issues:**
- **Parameter types hand-maintained** in both TS (`tools.json`) and Rust (`mcp/mod.rs` param structs) — no codegen between them.

### MCP server (`web/src-tauri/src/mcp/`)

**What works:**
- 14 tools exposed via rmcp (`mcp/mod.rs:146-385`). Note: `add_clip`, `remove_effect`, `toggle_effect` are in `tools.json` but missing from Rust MCP (17 vs 14 drift).
- stdio + streamable-HTTP transports (`mcp/transport.rs:48 LOC`).
- Read-only introspection operates on saved `.chatcut` file (`project/reader.rs`).
- Write tools mutate the project file on disk (`mcp/tools/mutation.rs`).

**Known issues:**
- **Pervasive error string conversion:** `Result<T, String>` loses error context. MCP clients get generic messages.
- **No transaction semantics:** Mutation tools can leave the project file in a partial state on failure.
- **Parameter structs don't validate against `tools.json` enum:** Rust `effect_id` is `String`, not an enum matching the 20 values in `tools.json:118-139`.
- **Lock file not PID-validated:** `lib.rs` uses a lock file to detect running instances, but doesn't check if the PID is still alive.

### FFmpeg pipeline (`web/src-tauri/src/export.rs`)

**What works:**
- Full export pipeline: filter graph → codec args → FFmpeg child process → progress parsing.
- 913 LOC, untouched and stable.

**Known issues:**
- **God file:** 5 structs + 20+ effect match arms + 3 Tauri commands all in one file. Splitting deferred to Phase 2.
- **Duplicated extension lists** fixed via `shared/extensions.rs:11 LOC`.

### UI layer (`web/src/components/`, `web/src/app/page.tsx`)

**What works:**
- Resizable panel layout via `react-resizable-panels` (`page.tsx:160-208`).
- Chat center column with floating popout option (`FloatingChatPanel.tsx`).
- Video library with drag-and-drop import (`VideoLibrary.tsx`).
- Timeline with tracks, clips, playhead, time ruler (6 files in `timeline/`).
- Export dialog (`export/ExportDialog.tsx`).
- Settings modal with provider picker + API key input (`page.tsx:222-236`).
- Keyboard shortcuts: Space (play/pause), arrows (seek), Cmd+Z/Shift+Z (undo/redo), Cmd+S (save), `/` (focus chat).

**Known issues:**
- **`page.tsx` is 240 LOC** with inline SVGs for every toolbar icon. Should extract icon components.
- **Settings modal is inline JSX** in `page.tsx:222-236`. Should be its own component.

### Legacy codebases (frozen)

**`backend/`** — FastAPI service. Works for UXP plugin. Has 8 MCP-blocking issues (`ISSUES.md` §1-8), 3 security issues (§9-11), 9 maintainability issues (§12-20). Being permanently removed for Tauri.

**`plugin/`** — Premiere Pro UXP panel. Stays on legacy backend. `plugin/backend/` is a dead byte-identical copy of `backend/` and should be deleted.

## Test coverage

| Area | Status |
|------|--------|
| `backend/tests/` | pytest, all mocked, no real Premiere integration |
| `plugin/frontend/src/tests/` | Jest configured, no actual test files |
| `web/` | **No test runner configured** |
| `web/src-tauri/` | **Zero `#[cfg(test)]` modules** |

## Documentation status

| Doc | Status | Notes |
|-----|--------|-------|
| Root `README.md` | Current | Accurate structural overview |
| `AGENTS.md` | **Partially stale** | Says "no MCP" but 14 MCP tools now exist in Rust. `add_clip`, `remove_effect`, `toggle_effect` absent from Rust — 17 in `tools.json`, 14 in MCP |
| `ISSUES.md` | **Partially resolved** | §1-3 fixed (MCP exists, BYO keys, tool introspection); §4-20 still relevant |
| `FREEZE.md` | Current | Sprint freeze ends 2026-05-15 |
| Sprint plan | Current | `docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md` |
| Rust refactor plan | Current | `docs/superpowers/plans/2026-05-09-rust-scope-d-plan.md` |
