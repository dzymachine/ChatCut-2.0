# F004: Composite Tools

> **Status:** planned
> **Target:** Phase 2 (post 2026-05-15)
> **Last touched:** 2026-05-11

## Summary

Higher-level tools that compose multiple atomic operations. Examples: `assemble_rough_cut` (imports media, creates clips, arranges on timeline), `apply_color_grade` (applies a coordinated set of color effects).

## Origin

Sprint plan §"What's cut" (`docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md:308`) — explicitly cut from sprint as sprint-only deferral.

## Requirements (placeholder)

1. **Composition layer:** Composite tools call sequences of atomic tools from `tools.json`. They don't bypass the tool registry — each sub-call produces its own `EditNode`.
2. **Batch undo:** The entire composite operation should be one undo entry (use existing `beginUndoBatch` / `commitUndoBatch`).
3. **Error handling:** If step 3 of 5 fails, the composite tool should rollback steps 1-2 and report what failed.
4. **Schema:** Composite tools get their own entries in `tools.json` with `type: "composite"`.

## Candidate tools

| Tool | Sub-operations |
|------|----------------|
| `assemble_rough_cut` | Import media → add clips in order → apply default transitions |
| `apply_color_grade` | Apply brightness + contrast + saturation + color_temperature as a coordinated preset |
| `split_and_remove` | Split clip at two points → remove middle segment → close gap |
| `create_montage` | Import N clips → trim each to duration → arrange sequentially with cross-dissolves |

## Open questions

- Should composite tools be defined in `tools.json` or in a separate `composites.json`?
- How does the agent decide when to use a composite vs. chaining atomic tools itself?
- Should composite tools show their sub-operations in the edit history, or just the top-level operation?
