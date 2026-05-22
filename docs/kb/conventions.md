# Conventions

> **Purpose:** Patterns, naming rules, and maintenance protocol for the ChatCut codebase and this KB.
> **Last touched:** 2026-05-11
> **Status:** Active

## KB maintenance protocol

### Weekly update rule (hard)

Every Sunday, one team member reviews the KB and:

1. Updates `last-touched` dates on any doc whose subject matter changed that week.
2. Verifies file:line citations still point to the right code (search for the cited text).
3. Moves completed roadmap items to `status: done`.
4. Archives any decision that was reversed into a new ADR referencing the old one.

**If a doc hasn't been touched in 2+ weeks and its area had commits, it is considered stale.** The updater must either refresh it or add a `> STALE — needs review` banner.

### Citation format

Every factual claim cites its source:

```
The agent loop caps at 8 iterations (`web/src/lib/agent/loop.ts:20`).
```

Use relative paths from the repo root. Include line numbers. If the claim spans a range, use `file.ts:20-35`.

### No temporal references

Write "as of version 1.1.0" or "as of `tools.json` schema v1.1.0", never "recently" or "last sprint". A cold reader 6 months from now must understand the doc without git-log archaeology.

---

## Codebase conventions

### State management

- **Single store:** `web/src/lib/store/editor-store.ts` is the source of truth. All mutations go through Zustand actions.
- **Slice independence:** Playback, Project, UI, and Timeline slices must not cross-modify each other except at documented boundaries (`editor-store.ts:7-29`).
- **Undo/redo:** Every mutation tool calls `beginUndoBatch` / `commitUndoBatch` (except `add_clip`, which manages its own undo entry — `tool-registry.ts:11-13`). The undo stack caps at 50 entries.

### Tool contract

- **Schema source of truth:** `web/src-shared/tools.json` (version 1.1.0, 17 tools). Both TS and Rust read from this file.
- **Tool types:** `introspection` (read-only, return data) vs `mutation` (modify state, produce `EditNode`).
- **Naming:** snake_case for tool names (`get_timeline_state`, `apply_effect`). Parameters also snake_case.
- **`clip_id` elision:** Most mutation tools accept an optional `clip_id`. When omitted, the handler falls back to `ui.selectedClipIds[0]` (`tool-registry.ts`).

### Effect system

- **Registry:** `web/src/lib/effects/registry.ts` defines `EffectDescriptor` objects with id, parameters, FFmpeg mapping.
- **IDs:** ChatCut effect IDs (e.g. `gaussian_blur`, `cross_dissolve`) are **not** Adobe matchNames. The two namespaces never mix.
- **Adding an effect:** See `playbooks/add-an-effect.md`.

### Provider architecture

- **BYO API key:** Users paste their own key for Anthropic, Groq, or Gemini. Keys stored in OS keychain or localStorage.
- **Provider interface:** Each adapter in `web/src/lib/agent/providers/` exports `streamTurn(messages, tools) → AsyncIterator<Delta>` behind a common `LLMProvider` interface (`providers/index.ts`).
- **Default:** Anthropic (claude-sonnet-4-7). Switchable at runtime via settings dropdown — no app restart.

### Naming & style

- **File naming:** kebab-case for files (`tool-registry.ts`), PascalCase for React components (`ChatPanel.tsx`).
- **Component structure:** One exported component per file. Co-locate styles (Tailwind classes inline).
- **Imports:** Use `@/` path alias for `web/src/`. Shared code uses relative paths to `src-shared/`.
- **Error handling:** Surface errors via `showToast("error", msg)` (`web/src/components/ui/toast-notification.tsx`). Console-log with `[ModuleName]` prefix for debugging.

### Frozen areas

Per `FREEZE.md`: `backend/` and `plugin/` are frozen until 2026-05-15. Do not modify. The Premiere plugin stays on the legacy FastAPI backend.

### Git

- Feature branches off `main`.
- No force pushes to `main`.
- Commit messages: imperative mood, <72 chars first line.
- Co-author attribution for AI-assisted commits.
