# F008: UXP / Tauri Schema Convergence

> **Status:** planned
> **Target:** Post-sprint (no specific date)
> **Last touched:** 2026-05-11

## Summary

Regenerate the UXP plugin's action schemas from `tools.json` so both clients share one source of truth. Currently the Premiere plugin has its own hand-maintained 575-LOC schema (`backend/services/providers/function_schemas.py`) that drifts from the desktop editor.

## Origin

Sprint plan §"Separate task" (`docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md:292-299`). Tracked as `chore/uxp-tauri-schema-convergence`.

## Two deliverables

### 1. Python codegen from `tools.json`

A small Python script reads `tools.json` and emits the Premiere matchName-keyed equivalent of `function_schemas.py`. Effect IDs in `tools.json` map to Adobe `matchName` IDs via a lookup table.

### 2. UXP action dispatcher migration

`plugin/frontend/src/services/actionDispatcher.js` (411 LOC, ~30 hand-mapped handlers) consumes `tools.json` as its action contract. The generated skeleton provides the action-name → handler mapping; per-action UXP body remains hand-written.

## Dependencies

- Sprint must land first (frozen per `FREEZE.md`).
- Need a matchName ↔ ChatCut-effect-ID mapping table (partially exists in `function_schemas.py`).

## Out of scope

- Re-architecting the UXP plugin. This is pure schema alignment, not a feature change.
- Moving the UXP plugin off the FastAPI backend (separate, larger effort).
