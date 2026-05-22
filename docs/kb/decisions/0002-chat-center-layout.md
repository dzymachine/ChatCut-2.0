# ADR-0002: Chat-Center Layout

> **Status:** Accepted
> **Date:** 2026-05-01
> **Decided in:** `docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md` (Decision #5)

## Context

Traditional NLEs (Premiere, DaVinci, FCP) use a source/program monitor + timeline + project panel layout. ChatCut v1 replicated this with chat as a sidebar. This said "chat is auxiliary" — the opposite of the product direction.

## Decision

Chat takes the center column. Video library and timeline are thin collapsible strips. The layout is:

```
+----------+------------------------+-------------+
| Library  |  Chat (center column)  | Edit History|
| (strip)  |  + Video Preview above |  (panel)    |
+----------+------------------------+-------------+
|                Timeline (strip)                  |
+-------------------------------------------------+
```

Implementation: `react-resizable-panels` (`web/src/app/page.tsx:160-208`). Chat can float as a draggable overlay (`FloatingChatPanel.tsx`).

Anti-patterns explicitly avoided:
- No tool palette or effects sidebar — effects accessed only by asking.
- No mode-switching pages (DaVinci's color/fairlight/fusion).
- No source-monitor / program-monitor quad.

## Consequences

- Chat is the primary interaction surface. Timeline and library are results/inputs, not the workspace.
- Screen real estate for video preview is reduced when chat is docked. Floating mode mitigates this.
- New features should default to chat-first affordances, not palette/panel patterns.
