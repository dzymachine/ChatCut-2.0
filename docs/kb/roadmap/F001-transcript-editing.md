# F001: Transcript Editing

> **Status:** planned
> **Target:** Q3 2026
> **Last touched:** 2026-05-11

## Summary

Transcript-first editing surface for talking-head content. A Whisper-generated transcript **is** the timeline — "delete this paragraph" removes the corresponding video segment.

## Origin

Sprint plan §"Vision direction" item 3 (`docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md:281`).

## Requirements (placeholder)

1. **Transcription:** Integrate Whisper (via Tauri Rust or external API) to generate word-level timestamps from video audio.
2. **Transcript view:** Render the transcript as selectable text in the chat/center column. Each word maps to a timeline range.
3. **Edit-by-text:** Selecting and deleting transcript text trims/removes the corresponding video segment. Selecting and splitting inserts a cut.
4. **Bidirectional sync:** Clicking a word in the transcript seeks the preview to that timestamp. Scrubbing the timeline highlights the current word.
5. **Agent integration:** The agent loop should be able to call transcript-aware tools (e.g. `delete_transcript_range`, `find_in_transcript`).

## Dependencies

- Whisper model hosting or API (Groq has Whisper API; local via `whisper.cpp` in Rust).
- Word-level timestamp support in the transcript data model.
- New tools in `tools.json` for transcript operations.

## Open questions

- Should the transcript be stored as part of the `.chatcut` project file?
- How does transcript editing interact with the undo/redo system?
- Does the user correct transcription errors manually, or is re-transcription the fix?

## Non-goals this iteration

- Speaker diarization (who said what).
- Multi-language support.
- Real-time transcription during recording.
