# ChatCut Knowledge Base

> **Purpose:** Single entry point for any agent or human landing cold on this repo.
> **Last touched:** 2026-05-11
> **Status:** Active — weekly update rule (see `conventions.md`)

## What is ChatCut?

A chat-first video editor built on Tauri + Next.js. The user describes edits in natural language; an agentic tool-use loop executes them against a Zustand store. External clients (Claude Desktop, Cursor) can drive the same tools via an MCP server in the Rust process.

## Quick navigation

| Doc | What it answers |
|-----|-----------------|
| [`current-state.md`](current-state.md) | What exists today, module by module, with line-number citations |
| [`architecture.md`](architecture.md) | Module map, data flow diagrams, layer boundaries |
| [`conventions.md`](conventions.md) | Naming, patterns, do/don't, KB maintenance protocol |
| [`decisions/`](decisions/) | ADR-style records — immutable once written |
| [`roadmap/`](roadmap/) | Placeholder feature specs with status tracking |
| [`playbooks/`](playbooks/) | "How do I X" step-by-step recipes |

## Cross-links to existing docs

These live at the repo root and are **not replaced** by the KB — they serve different roles:

| File | Role | Relationship to KB |
|------|------|--------------------|
| [`AGENTS.md`](../../AGENTS.md) | Cold-start codebase map for agents | KB's `current-state.md` adds depth; AGENTS.md stays as the quick-reference |
| [`ISSUES.md`](../../ISSUES.md) | Gap analysis: 20 architectural/security/maintainability issues | KB's `roadmap/` tracks what's planned; ISSUES.md tracks what's wrong |
| [`FREEZE.md`](../../FREEZE.md) | Sprint freeze policy for `backend/` and `plugin/` (ends 2026-05-15) | KB's `conventions.md` references the freeze |
| [`docs/superpowers/plans/`](../superpowers/plans/) | Sprint plans and Rust refactor plans | KB's `roadmap/` extracts vision features from these |

## For agents switching models

Every claim in this KB cites `path/to/file.ts:NN`. No temporal references ("recently", "last week"). No assumed context. Each file opens with a one-line purpose + last-touched date + status. You can feed any single file to a cold model and it will orient itself.
