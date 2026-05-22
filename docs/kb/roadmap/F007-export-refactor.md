# F007: Export Pipeline Refactor

> **Status:** planned
> **Target:** Phase 2 (post 2026-05-15)
> **Last touched:** 2026-05-11

## Summary

Split the 913-LOC `export.rs` god-file into focused modules.

## Origin

Sprint plan §"Proposed architecture (target)" (`docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md:118-134`) — explicitly deferred from sprint ("900 LOC of working FFmpeg code; risk of breakage > value during this sprint").

Rust refactor plan: `docs/superpowers/plans/2026-05-09-rust-scope-d-plan.md`.

## Target structure

```
web/src-tauri/src/export/
  mod.rs          -- public surface + ExportState
  filters.rs      -- build_effect_filters / build_audio_filters / build_filter_complex
  codec.rs        -- codec arg builders (h264/h265/prores/...)
  progress.rs     -- FFmpeg stderr parser
  pipeline.rs     -- export_video, get_export_progress, cancel_export, probe_media commands
```

## Constraints

- **No behavior changes.** This is a pure structural refactor. Every FFmpeg filter string and codec arg must remain byte-identical.
- **No new deps.** The export module stays self-contained.
- **Test before/after:** Create fixture inputs and verify the generated FFmpeg command lines match exactly.

## Current pain points in `export.rs`

- 5 structs + 20+ effect match arms + 3 Tauri commands in one file.
- Adding a new effect requires editing the core god-file.
- Effect → FFmpeg filter mapping is one giant `match` statement (`build_effect_filters` at line 134, match at line 142).
- No tracing — FFmpeg stderr dropped except on hard failure.
