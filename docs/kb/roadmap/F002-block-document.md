# F002: Block-Based Edit Document

> **Status:** planned
> **Target:** Q3 2026
> **Last touched:** 2026-05-11

## Summary

Notion-for-video. Each clip is a block with chat affordances. Vertical layout replaces the horizontal track grid. Users compose videos by arranging blocks, not by dragging clips on a timeline.

## Origin

Sprint plan §"Vision direction" item 2 (`docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md:279`).

## Requirements (placeholder)

1. **Block model:** Each block represents a clip or a text overlay. Blocks stack vertically. Blocks can be reordered by drag-and-drop or via chat ("move this clip after the intro").
2. **Per-block chat:** Each block has its own chat affordance for editing (e.g. "trim this to 10 seconds", "add a fade-in"). Global chat still works for cross-block operations.
3. **Block types:** Video clip, audio clip, text overlay, transition (between two adjacent blocks), chapter marker.
4. **Preview:** Clicking a block previews that segment. Playing from a block plays sequentially through subsequent blocks.
5. **Export:** Block order determines final video sequence. Transitions between blocks render at boundaries.

## Dependencies

- UI framework for block reordering (consider `@dnd-kit` or similar).
- New data model in `editor-store.ts` — blocks as a flat ordered list rather than tracks+clips.
- Migration path from current tracks-based model to block model.

## Open questions

- Does the block model replace tracks entirely, or coexist (blocks as a view on top of tracks)?
- How do multi-track scenarios (picture-in-picture, split screen) map to blocks?
- Does each block get its own undo history, or is undo global?

## Anti-patterns to avoid

- Don't rebuild a timeline with vertical orientation. Blocks should feel like a document, not a rotated NLE.
- Don't force users to manually manage block boundaries. The system should auto-split at cuts.
