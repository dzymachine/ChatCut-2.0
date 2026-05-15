# ChatCut Tauri Editor — Agentic-Chat-First Sprint

**Sprint window:** 1 week (5 working days), within the broader 2026-05-15 deadline.
**Team:** 3 devs (1 high effort ≈50h, 1 mid ≈30h, 1 low ≈18h). ~100 dev-hours total.
**Pivot from:** the approved [`docs/superpowers/specs/2026-04-22-backend-mcp-migration-design.md`](../specs/2026-04-22-backend-mcp-migration-design.md) — that plan is **superseded** for the May-15 window.

---

## Context

The earlier May-15 plan kept the FastAPI backend, ported 9 mutations + 5 introspection tools, added Claude alongside Gemini/Groq, and treated stdio MCP as a Phase-4 buffer smoke test. It worked equally for Premiere UXP and Tauri.

User has decided to:
1. **Drop the FastAPI backend entirely** for the Tauri editor.
2. **Focus the sprint on Tauri only**; UXP plugin frozen against existing backend.
3. **Use [rmcp](https://github.com/modelcontextprotocol/rust-sdk) (Rust MCP SDK)** so the editor can be driven internally and (post-sprint) by external MCP clients.
4. Build toward an **agentic-chat-first editor that does not replicate Premiere or DaVinci** — chat is the primary surface, not a sidebar.
5. Add an **edit-history surface with summaries + rollback** (rollback is now cheap because Zustand `pushUndo` already snapshots tracks+playback per command — no spike needed).

---

## Decisions locked

| # | Decision | In plain English |
|---|---|---|
| 1 | **rmcp = external-client surface only** for this sprint. Internal chat does **not** route through MCP — direct Zustand mutation. The Rust process exposes the same canonical tools so Claude Desktop / Cursor / CLIs can attach later. Internal-routing-through-MCP is a deliberate Phase 2 (data model already supports it). | When you type in the chat inside the app, it talks directly to the editor state — no Rust middleman. But when Claude Desktop or Cursor connects from outside, that goes through the Rust MCP server. |
| 2 | **Schema source of truth: one JSON file** at `web/src-shared/tools.json`. Rust reads via `serde_json` + `schemars`; TS imports directly. Day-0 deliverable; everything blocks on it. | One file lists every action the editor can do. Both TypeScript and Rust read from it so they never disagree. Nothing else gets merged until this file exists. |
| 3 | **BYO API key for Anthropic, Groq, or Gemini.** Each key entered in app settings, stored in OS keychain via `tauri-plugin-stronghold` or `tauri-plugin-keyring`. Webview calls each provider directly (`dangerouslyAllowBrowser: true` for Anthropic; Groq's OpenAI-compatible SDK; `@google/genai` for Gemini). No proxy through Rust. Anthropic is the default; user picks via dropdown in settings. | Users paste their own key for whichever provider they want — Claude, Groq, or Gemini. The browser-side code calls each provider directly. Rust never touches AI requests. Each provider is wrapped behind a common `LLMProvider` interface so the agent loop doesn't care which one is selected. |
| 4 | **UXP plugin frozen.** Stays on legacy FastAPI backend during sprint. No code changes. A separate non-sprint task (below) tracks the eventual schema convergence. | Don't touch `plugin/` or `backend/`. The Premiere Pro plugin keeps working as-is. |
| 5 | **One UI bet:** chat takes the center column; library + timeline collapse to strips. Block-based document, transcript-first, tree-as-project file are documented as vision and **not shipped this sprint**. | Chat is the main thing you see. The video library and timeline shrink to thin strips on the sides. Fancier ideas (Notion-like blocks, transcript editing) are future work. |

---

## Architecture (sprint target)

**The short version:** The app has two halves. The **webview** (a browser window running React/TypeScript) is where chat, editing, and AI happen. The **Rust process** handles file I/O, video export, and serves as an MCP server so external tools like Claude Desktop can connect. Chat does NOT go through Rust — it talks directly to the editor state in the webview.

```
                                ┌──────────────────────────┐
                                │     Anthropic API        │
                                └─────────────┬────────────┘
                                              │  HTTPS · BYO key from keychain
   ┌──────────────────────────────────────────┴────────────────────────────┐
   │  Tauri webview (TS)                                                   │
   │  • lib/agent/loop.ts  — agentic tool-use loop (max 8 iter)            │
   │  • lib/agent/tool-registry.ts  — imports tools.json,                  │
   │      maps each tool to a Zustand action                               │
   │  • components/chat/ChatPanel.tsx  — center column, streams deltas     │
   │  • components/history/EditHistoryPanel.tsx  — linear list,            │
   │      reads editor-store.editHistory[], click-to-rollback              │
   │  • Existing Zustand store unchanged shape — adds `editHistory[]`      │
   └────────────────────────────┬──────────────────────────────────────────┘
                                │  Tauri invoke()  (file IO, FFmpeg only)
   ┌────────────────────────────┴──────────────────────────────────────────┐
   │  Tauri Rust process                                                   │
   │  ┌─────────────────────────────────────────────────────────────────┐  │
   │  │  rmcp server                                                    │  │
   │  │  • stdio transport when launched as `chatcut --mcp` (subcmd)    │  │
   │  │  • streamable-HTTP on 127.0.0.1:7331 when running normally      │  │
   │  │  • Tools generated from tools.json via schemars                 │  │
   │  │  • v1: read-only handlers operate on saved .chatcut file        │  │
   │  │  • v1: write handlers refuse if app instance is open            │  │
   │  │       (avoids two-writer races; Phase 2 adds event bridge)      │  │
   │  └─────────────────────────────────────────────────────────────────┘  │
   │  + existing FFmpeg export (src-tauri/src/export.rs, 900 LOC)          │
   │  + existing native dialog / fs commands (src-tauri/src/commands.rs)   │
   └───────────────────────────────────────────────────────────────────────┘
                                ▲
                                │ stdio · streamable-HTTP
                                │
              Claude Desktop · Cursor · CLI clients (post-sprint, no extra work needed)
```

**Why this shape:** the agent loop already lives where the editor state lives (the webview). Routing it through Rust would require a request/response-over-Tauri-events bridge with correlation IDs and timeouts — that bridge alone eats the week. External MCP clients are still served by the Rust rmcp server; they just hit the project file rather than a live store. Phase 2 promotes the Rust server to broker live edits via an event bridge.

**"Why not route chat through Rust?"** — Because building the bridge to pass messages back and forth between Rust and the webview (with proper timeouts, error handling, and request tracking) would take the entire sprint by itself. The editor state already lives in the webview, so the chat loop just calls it directly.

---

## Tauri Rust process — current state and proposed architecture

### Current state

The Rust side is a **1,061-LOC vibe-coded FFmpeg wrapper** that grew without a plan:

```
src-tauri/src/
├── main.rs       (6 LOC)    — entry; calls lib.rs::run()
├── lib.rs        (25 LOC)   — Tauri builder; registers 8 commands
├── commands.rs   (130 LOC)  — file metadata, dir listing, ffmpeg detect — flat list of #[tauri::command] fns
└── export.rs     (900 LOC)  — single god-file: filter graph builder, codec args, progress parser, export pipeline, probe_media — 5 structs + 20+ effect match arms + 3 Tauri commands all in one file
```

**Pain points:**
- **No modules.** Everything is at the crate root — `mod commands; mod export;`. Adding a third sibling (`mcp/`) without restructuring keeps the flat shape and gets messier fast.
- **God file (`export.rs`).** Effect → FFmpeg-filter mapping is one giant `match` statement (lines 131-304). Adding an effect requires editing the core. There is no effect registry the MCP layer can query.
- **Duplicated extension lists.** Video/audio file extensions hardcoded twice in `commands.rs` (lines 34-35 and 60-63). Drift waiting to happen.
- **String errors everywhere.** Every `Result<T, String>` loses error context. MCP needs structured errors so callers can distinguish "ffmpeg missing" from "input invalid" from "process crashed."
- **No tracing.** No `log`, `tracing`, or `env_logger` imports. FFmpeg stderr is dropped except on hard failure.
- **No tests.** Zero `#[cfg(test)]` modules.
- **Single crate.** No workspace; the upcoming `mcp/` will pile into the same `chatcut_lib` package.

### Proposed architecture (target)

```
src-tauri/
├── Cargo.toml                      — adds: rmcp, tokio (full), schemars, tracing, tracing-subscriber, thiserror
└── src/
    ├── main.rs                     — entry (unchanged)
    ├── lib.rs                      — Tauri builder + module wiring; spawns MCP transport in setup hook
    ├── error.rs                    — NEW: typed errors via `thiserror` (FfmpegMissing, InputInvalid, ExportCrashed, ProjectFileMalformed, AppInstanceLocked, ...). All commands return Result<T, ChatCutError>; serde_json::Error wraps cleanly.
    ├── shared/
    │   └── extensions.rs           — NEW: const VIDEO_EXTS / AUDIO_EXTS — single source for both commands.rs and probe_media
    ├── commands/
    │   ├── mod.rs                  — re-exports
    │   ├── fs.rs                   — get_file_metadata, list_media_files, get_app_data_dir (from current commands.rs)
    │   └── ffmpeg.rs               — check_ffmpeg (from current commands.rs)
    ├── export/                     — split out from current 900-LOC export.rs:
    │   ├── mod.rs                  — public surface + ExportState
    │   ├── filters.rs              — build_effect_filters / build_audio_filters / build_filter_complex
    │   ├── codec.rs                — codec arg builders (h264/h265/prores/...)
    │   ├── progress.rs             — FFmpeg stderr parser
    │   └── pipeline.rs             — export_video, get_export_progress, cancel_export, probe_media commands
    ├── project/                    — NEW: .chatcut file IO (shared with MCP read-only tools)
    │   ├── mod.rs
    │   └── reader.rs               — port relevant pieces from web/src/lib/project/serializer.ts; serde-driven
    └── mcp/                        — NEW (sprint deliverable):
        ├── mod.rs                  — ChatCutServer struct, #[tool_router]
        ├── transport.rs            — stdio + streamable-HTTP wiring
        └── tools/
            ├── mod.rs
            ├── introspection.rs    — read-only tools (use project::reader)
            └── mutation.rs         — write tools (refuse if app instance is open)
```

**Why this shape:**
- **Modules separate concerns.** `commands/` is for things the webview calls. `mcp/` is for things external clients call. `export/` is the FFmpeg pipeline. `project/` is the on-disk format. Today these are tangled.
- **`project/` is shared between webview commands and MCP tools.** When the MCP server reads a saved `.chatcut` file, it goes through the same code the rest of the app uses.
- **`error.rs` makes MCP errors meaningful.** rmcp's `Error` type wraps any `Display` — but if we return structured variants, an external Claude Desktop user can see "ChatCut is open; mutations from external clients are not yet supported in v1" rather than a generic string.
- **`shared/extensions.rs` kills the duplication** between current `commands.rs:34-35` and `:60-63`.

### Sprint scope (what we actually do this week)

This is a 1-week sprint with 3 devs. We do **not** boil the ocean. The minimum viable refactor for Track A:

| Refactor | This sprint? | Why |
|---|---|---|
| Add `error.rs` with `thiserror` | **Yes** | rmcp tools need structured errors; cheap to add. |
| Add `shared/extensions.rs` | **Yes** | Used by `project/` parsing too — natural side effect. |
| Add `project/reader.rs` | **Yes** | MCP read-only tools depend on it. |
| Add `mcp/` module tree | **Yes** | The whole point of Track A. |
| Add `tracing` + `tracing-subscriber` | **Yes** | One-time wiring; saves debugging time during the sprint itself. |
| Split `commands.rs` into `commands/{fs,ffmpeg}.rs` | **Yes** | Trivial move; keeps the new layout consistent. |
| Split `export.rs` into `export/{filters,codec,progress,pipeline}.rs` | **No — defer to Phase 2** | 900 LOC of working FFmpeg code; risk of breakage > value during this sprint. Leave as a single file but move into `export/mod.rs` for now. |
| Add tests for export/ | **No — defer** | Out of scope for this sprint. |
| Convert single crate → workspace | **No — defer** | Premature; reconsider when crate hits ~5k LOC. |

**Bottom line:** the Tauri side ends the sprint with a clean module tree, real error types, and a tracing setup — but `export.rs` stays a god-file (just relocated) until a follow-up. Track A's owner should not get sucked into refactoring FFmpeg code; it works today and isn't on the critical path.

---

## Schema source of truth

Think of `tools.json` as the **menu** — it lists every action the editor can do (trim a clip, add an effect, etc.) along with what parameters each action takes. Both the TypeScript UI and the Rust backend read from this one file so they never disagree about what's possible.

**File:** `web/src-shared/tools.json`

**Sprint surface (~10 tools):**

| Tool | Type | Notes |
|---|---|---|
| `get_timeline_state` | introspection | tracks + clips + composition |
| `get_media_library` | introspection | imported sources |
| `get_clip_at_time` | introspection | what's at playhead |
| `get_selected_clip` | introspection | for `clip_id`-elision in chat |
| `add_clip` | mutation | from media → track at time |
| `remove_clip` | mutation | by id |
| `trim_clip` | mutation | sourceStart / sourceEnd |
| `move_clip` | mutation | trackId + timelineStart |
| `apply_effect` | mutation | effect id from `lib/effects/registry.ts` |
| `update_effect_param` | mutation | numeric param on applied effect |

Bias toward introspection-heavy. Mutations target the existing Zustand actions (`addClipFromMedia`, `removeClip`, `trimClipStart/End`, `moveClip`, `addEffect`, `updateEffect`) — no new editor logic this sprint.

**Codegen:**
- TS: import JSON directly, types via `tsx`-generated `tools.ts` (`json-schema-to-typescript`).
- Rust: `serde_json::from_str` at compile time into `OnceCell<Vec<ToolDef>>`; `#[tool]` macro instances created dynamically.

---

## The 1-week plan

### Day 0 (joint, 4h, all hands — Mon AM)

- Pair-write `web/src-shared/tools.json` and an `EditNode` type spec. **No code merges until this lands.**
- Move `backend/` and `plugin/` to a `legacy/` parent dir or just leave them; create `FREEZE.md` at root noting the UXP plugin remains on legacy backend.
- Create the sprint feature branch off the existing `chore/backend-mcp-migration-plan` worktree (since that plan is now superseded).

### Track A — Rust + rmcp (high-effort, ~50h)

**Owner:** the dev who will own Rust long-term. Most load-bearing track.

**What you need to know first:** Rust basics, `cargo`, async programming with `tokio`. You'll be reading the [rmcp examples](https://github.com/modelcontextprotocol/rust-sdk/tree/main/examples/servers/src) heavily — bookmark them.

| Day | Deliverable | Files |
|---|---|---|
| 1 | `Cargo.toml` adds `rmcp = "1.6"` (`features = ["server", "macros"]`), `tokio = { version = "1", features = ["full"] }`, `schemars`, `tracing`, `tracing-subscriber`. Scaffold `src-tauri/src/mcp/mod.rs` with a `ChatCutServer` struct, `#[tool_router(server_handler)]`, and a single `#[tool] fn ping()` for smoke. | `web/src-tauri/Cargo.toml`, `web/src-tauri/src/mcp/mod.rs`, `web/src-tauri/src/lib.rs` |
| 2 | Implement read-only tools that read the saved `.chatcut` project from disk via the existing serializer logic (port relevant pieces from `web/src/lib/project/serializer.ts` to Rust, or call the existing `chatcut_lib` crate functions if they're already there — see `commands.rs`). Tools: `get_timeline_state`, `get_media_library`, `get_clip_at_time`, `get_selected_clip` (last one returns null when run via external MCP). | `web/src-tauri/src/mcp/tools/introspection.rs` |
| 3 | Implement write tools. Behavior: if a Tauri app instance is running on this machine (detect via lock file at app-data-dir or `tauri-plugin-single-instance`), refuse with a clear error message ("ChatCut is open; mutations from external MCP clients are not yet supported in v1 — coming in Phase 2"). When app is closed, mutate the project file directly. | `web/src-tauri/src/mcp/tools/mutation.rs` |
| 4 | Wire transports: stdio when CLI flag `--mcp` is present (use `tokio::io::{stdin, stdout}` per rmcp examples like [`counter_stdio.rs`](https://github.com/modelcontextprotocol/rust-sdk/blob/main/examples/servers/src/counter_stdio.rs)); streamable HTTP via [`counter_streamhttp.rs`](https://github.com/modelcontextprotocol/rust-sdk/blob/main/examples/servers/src/counter_streamhttp.rs) bound to `127.0.0.1:7331` when launched normally. Spawn from `lib.rs::run()` setup hook. | `web/src-tauri/src/mcp/transport.rs`, `web/src-tauri/src/lib.rs` |
| 5 | Smoke test with `npx @modelcontextprotocol/inspector` + integration with Track B/C. Add `gh-readme.md` snippet for "use ChatCut from Claude Desktop." | — |

**Reuse:** existing Tauri commands in `web/src-tauri/src/commands.rs` (130 LOC) handle file IO and ffmpeg detection; tools should call those, not reimplement.

### Track B — TS bridge + edit history (mid-effort, ~30h)

**Owner:** the dev most familiar with the existing Zustand store.

**What you need to know first:** React, TypeScript, and [Zustand](https://github.com/pmndrs/zustand) (our state management library — like Redux but simpler). You'll be wiring new code into the existing store, so read `editor-store.ts` and `command-handler.ts` first.

| Day | Deliverable | Files |
|---|---|---|
| 1 | `lib/agent/tool-registry.ts`: import `tools.json`, register a handler per tool that calls the matching Zustand action. Reuses existing actions in `editor-store.ts` (`addClipFromMedia`, `removeClip`, `trimClipStart/End`, `moveClip`, `addEffect`, `updateEffect`); reuses descriptors from `lib/effects/registry.ts`. | `web/src/lib/agent/tool-registry.ts`, `web/src/lib/agent/types.ts` |
| 2 | Edit-history data model added to `editor-store.ts`. Shape: `editHistory: EditNode[]`, `EditNode = { id, parentId: string \| null, toolName, args, summary?: string, snapshotIndex: number, createdAt: number }`. Append on every successful tool execution; `snapshotIndex` references the existing `undoStack` entry pushed by `command-handler.ts`. **No new snapshot mechanism** — reuse `pushUndo`. | `web/src/lib/store/editor-store.ts`, `web/src/types/editor.ts` |
| 3 | `EditHistoryPanel.tsx` — vertical list, latest on top. Each row: summary line + tool name + relative timestamp + rollback button. Replaces the Cmd+Z affordance from `app/page.tsx:201-236` (those buttons stay as keyboard handlers but the visual surface is the history panel). | `web/src/components/history/EditHistoryPanel.tsx` |
| 4 | Per-node summaries: after each tool resolves, fire one `claude-haiku-4-5` request with `{ tool, args, beforeStateDigest, afterStateDigest }` → one-line summary. Cache on the node. Skip on tool error. Failures degrade silently to the tool name. | `web/src/lib/agent/summarize.ts` |
| 5 | Rollback wiring: clicking an `EditNode` invokes `useEditorStore.getState().rollbackToNode(nodeId)` which restores from the underlying `undoStack[snapshotIndex]` and truncates `editHistory` past that node (a future "branch" mode keeps siblings; for sprint, truncate). Integration with Track A: emit a Zustand subscription event so external MCP introspection sees the rollback if it polls. | `web/src/lib/store/editor-store.ts` |

**Critical reuse callouts:**
- `web/src/lib/commands/command-handler.ts:94-115` already does `structuredClone` of tracks + playback before each command — Track B's `snapshotIndex` references the same `undoStack`. Don't duplicate snapshotting.
- `web/src/lib/effects/registry.ts:getEffectDescriptor` is the canonical effect catalog. The `apply_effect` tool's `effect_id` enum should be generated from it (Day 0 `tools.json` build step).

### Track C — UI rework + agent loop (low-effort, ~18h)

**Owner:** the dev with the most design taste; lowest hours, highest visibility.

**What you need to know first:** React, CSS/Tailwind layout, and be comfortable deleting code. Most of Day 1-2 is removing UI elements, not adding them. Day 3 requires understanding the [Anthropic SDK](https://docs.anthropic.com/en/api/client-sdks) for the agent loop.

| Day | Deliverable | Files |
|---|---|---|
| 1 | UI cleanups: delete the mode dropdown (`ChatPanel.tsx:53-62`), delete the "Connected" indicator (`:64-80`) — replace with a provider-name pill (`Sonnet 4.7` / `Llama 3.3 70B (Groq)` / `Gemini 2.5 Pro`) that reads from the active provider in settings. Delete the hardcoded example prompts welcome state (`:86-121`); replace with a single big input centered. | `web/src/components/chat/ChatPanel.tsx` |
| 2 | Layout pivot in `app/page.tsx:264-286`: chat takes the center flex column. Library collapses to a 48px icon strip (clickable to expand to 280px). Timeline becomes a 80px collapsible bottom strip (click to expand to current 240+px). Top bar trimmed: keep New / Save / Export; move undo/redo + library-toggle + chat-toggle into a `⋯` overflow menu. | `web/src/app/page.tsx` |
| 3 | `lib/agent/loop.ts`: provider-agnostic tool-use loop, max 8 iterations, abort signal piped from chat unmount. Behind it sits `lib/agent/providers/` with three adapters: `anthropic.ts` (browser SDK + prompt-caching cache breakpoint after `system + tools`, model `claude-sonnet-4-7`), `groq.ts` (OpenAI-compatible SDK, model `llama-3.3-70b-versatile`), `gemini.ts` (`@google/genai`, model `gemini-2.5-pro`). Each adapter exposes `streamTurn(messages, tools) → AsyncIterator<Delta>` with a normalized `Delta` type covering text + tool-use deltas. Calls Track B's `tool-registry.execute()`. Stream into the chat. Tool calls render as collapsed `<ToolCallCard>` cards. | `web/src/lib/agent/loop.ts`, `web/src/lib/agent/providers/{anthropic,groq,gemini,index}.ts`, `web/src/components/chat/ToolCallCard.tsx` |
| 4 | Empty state: "What do you want to make?" centered above the input, with a list of recent projects loaded from Tauri app-data-dir. Settings page: provider dropdown (Anthropic / Groq / Gemini, default Anthropic) + one API-key input per provider, each stored via `tauri-plugin-keyring` under a separate keychain entry. Switching the dropdown picks which adapter the agent loop uses on the next turn — no app restart. | `web/src/components/chat/EmptyState.tsx`, `web/src/components/settings/ApiKeySetting.tsx`, `web/src/components/settings/ProviderPicker.tsx` |
| 5 | Polish: keyboard shortcut `/` focuses chat from anywhere; toast on tool errors; empty `editHistory` panel state ("No edits yet — describe what you want to make."). | — |

**Reuse:** existing `lib/tauri/bridge.ts` for Tauri detection; `components/ui/toast-notification.tsx` for errors; `components/ui/scroll-area.tsx` for chat scroll.

### Day 5 cross-track (PM)

- Smoke: open app → settings → paste Anthropic key → drop a video → "trim the first 5 seconds and add a fade-in" → see two history nodes with summaries → click the first to rollback → state restored → close app → `npx @modelcontextprotocol/inspector chatcut --mcp` → list tools → call `get_timeline_state`.
- Tag a release. Update root `README.md`. Record a 60s demo.

---

## UI flaws — current state and sprint fix

References are `web/src/`-relative.

| File:line | Flaw | Sprint fix |
|---|---|---|
| `components/chat/ChatPanel.tsx:53-62` | **Mode dropdown** ("Effects" / "Generate") forces user to pre-classify intent — anti-agentic. | Delete. Claude routes. |
| `components/chat/ChatPanel.tsx:64-80` | **"Connected" indicator** assumes a server. Tauri-only, "connected to what?" — confusing. | Replace with model-name pill. |
| `components/chat/ChatPanel.tsx:86-121` | **Hardcoded imperatives** ('"Zoom in by 150%"') anchor users to button-clicking mental model. | Single input, "What do you want to make?". |
| `app/page.tsx:264-286` | **Premiere-clone tripartite layout** + bottom timeline. Says "chat is auxiliary." | Chat owns center column; library + timeline collapse to strips. |
| `app/page.tsx:103-261` | **12+ icon buttons in top bar.** | Keep New / Save / Export; rest into `⋯` menu. |
| `app/page.tsx:201-236` | **Cmd+Z is the only undo affordance.** Existing 1890-LOC store has linked clips, batched undo, etc. — UI surfaces none. | EditHistoryPanel exposes the actual session graph. |
| `components/editor/VideoLibrary.tsx` (always visible) | Implies manual asset management as the primary workflow. | Collapse to 48px icon strip. |
| `components/editor/timeline/Timeline.tsx` (always visible) | Timeline is a **result** in chat-first, not the workspace. | Collapsible 80px bottom strip. |
| (everywhere) | **No surface for the agentic loop's intermediate tool calls.** | Inline `<ToolCallCard>` cards in chat stream + nodes in history panel. |

---

## Vision direction (do not ship this sprint)

ChatCut should become — pick **one** axis per quarter, not all:

1. ✅ **Chat-center layout.** Shipping this sprint.
2. **Block-based edit document.** Notion-for-video. Each clip is a block with chat affordances; vertical layout, no horizontal track grid. **Defer to Q3.**
3. **Transcript-first surface** for talking-head content. Whisper transcript IS the timeline; "delete this paragraph" is the interaction. **Defer Q3-Q4.**
4. **Tree-as-project file.** The `editHistory` IS the `.chatcut` file. Rolling back = checking out a node. Branches enable A/B exploration. **Phase 2 (post-May 15)** — data model from this sprint already supports it.
5. **No tool palette, ever.** Effects accessed only by asking. Hard line. Already aligned.

Anti-patterns explicitly avoided:
- Premiere's source-monitor / program-monitor / project-panel quad
- DaVinci's mode-switching pages (color, fairlight, fusion)
- FCP's magnetic timeline + skimming
- A "tools" or "effects" sidebar of any kind

---

## Separate task — UXP / Tauri shared schema convergence (post-sprint, not in this week)

The UXP plugin is frozen against the legacy FastAPI backend during this sprint. After the sprint, two pieces of cross-cutting work make both clients simpler:

1. **Regenerate `backend/services/providers/function_schemas.py` from `tools.json`.** The Premiere-side schema today is 575 LOC, hand-maintained, drifting from the desktop schema. A small Python codegen script reads `tools.json` and emits the Premiere matchName-keyed equivalent. Eliminates the duplication called out in `ISSUES.md` §6.
2. **Migrate the UXP plugin's `actionDispatcher.js` action registry to consume `tools.json`** as its action contract. Today the plugin has ~30 hand-mapped action handlers in `plugin/frontend/src/services/actionDispatcher.js` (411 LOC); regenerating that mapping skeleton from `tools.json` + a per-action UXP body is a straightforward refactor.

Track this as `chore/uxp-tauri-schema-convergence` after the sprint lands. Not blocking and not on the critical path — pure tech-debt reduction across the two clients.

---

## What's cut — sprint-only vs. permanent

| Cut | Sprint-only or permanent? |
|---|---|
| Server-side Gemini / Groq providers | **Permanent removal** (browser-side adapters replace them; see Track C Day 3). |
| Composite tools (`assemble_rough_cut`, etc.) | **Sprint-only.** Phase 2. |
| Tree-shaped history UI | **Sprint-only.** Data model is tree-ready; UI is linear list. |
| Premiere UXP plugin work | **Sprint-only freeze.** Plugin keeps working against legacy backend. |
| Capability profiles (premiere/fcp/davinci/chatcut) | **Permanent simplification.** ChatCut profile only. Premiere becomes a separate project. |
| Vendored hetpatel schemas | **Permanent.** Premiere world is split out. |
| FastAPI Python backend | **Permanent removal** for Tauri. UXP plugin's legacy use is the only consumer until the convergence task. |
| Redis cache | **Permanent removal.** Single-user local. |
| `/api/turn` HTTP endpoint | **Permanent removal.** |
| Legacy endpoint shims | **Permanent removal.** |
| structlog observability / golden snapshot tests | Sprint-only defer. |
| Claude prompt caching | **Kept.** Free perf. |
| Per-node rollback | **Kept.** Reuses existing `pushUndo` snapshots. |
| Per-node Haiku summary | **Kept.** |

---

## What's weak / already been done

Read this before you write any code. It'll save you from rebuilding things that exist, fixing things that are frozen, and trusting things that are broken.

### Already tried — don't redo

| What | Status | Why it's here |
|---|---|---|
| **FastAPI backend** (`backend/`) | Phases 1-2 complete, architecturally dead-ended | Works for the UXP plugin, but has 8 blocking issues (no MCP, server-side LLM lock-in, no tool introspection, triplicated schemas — see `ISSUES.md` §1-8). We're not fixing it; it's frozen for this sprint. |
| **4-week MCP migration plan** (`docs/superpowers/plans/2026-04-22-backend-mcp-migration-plan.md`) | Superseded by this sprint plan | Good research, but scoped too wide: tried to serve both UXP + Tauri, support 3 LLM providers, and had 43 tasks. This sprint narrows to Tauri-only + Anthropic-only. |
| **Server-side Gemini / Groq provider adapters** (`backend/services/providers/gemini_provider.py`, `groq_provider.py`) | Working, replaced — not deleted yet | These run inside FastAPI and lock the LLM to backend-held keys. We're rebuilding them browser-side as BYO adapters in Track C. **You can crib the system prompts and tool-call shape from these files**, but don't import them and don't port the Python — translate the patterns to TS. |
| **`actionDispatcher.js`** (plugin) and **`action-mapper.ts`** (web) | Working but being replaced | These are hand-mapped string-switch dispatchers. `tools.json` replaces them. Don't extend the old ones. |

### Known weak spots — handle with care

These are things that exist but are fragile, broken, or untested. If your work touches them, verify before you build on top.

- **Audio preview is broken.** Commit `7f190bd` ("audio in preview broke") is the latest on `main`. Don't assume preview works end-to-end — test it manually before demoing.
- **Video library is new and possibly fragile.** Commit `8313637` just landed. If you're importing media programmatically, expect edge cases.
- **There are zero tests.** No unit tests, no integration tests, no E2E. If you break something, you won't know until you see it on screen. This is why Day 5 is a manual smoke test.
- **Schema drift between old files.** `function_schemas.py` and `function_schemas_desktop.py` already have different parameter names for the same actions (`ISSUES.md` §6). The `tools.json` single-source-of-truth fixes this — but don't copy-paste from the old schema files.
- **`useChat.ts` hook may be incomplete.** It exists and handles two chat modes, but mode-switching logic may not be wired correctly. Verify before building the agent loop on top of it.
- **Project serialization may not round-trip all state.** `saveProject`/`loadProject` exist in `serializer.ts`, but they haven't been tested against the full store shape. Track A (Rust MCP reads from saved `.chatcut` files) depends on this — test serialization early.

### What's solid — safe to build on

These systems are production-ready. Use them; don't rewrite them.

- **Undo/redo** (`editor-store.ts`): `pushUndo()`, `undo()`, `redo()`, batch operations, 50-entry stack limit. Every mutation already captures before/after snapshots.
- **Command handler** (`command-handler.ts`): `executeAction()` wraps 12+ action types with automatic undo capture. Snapshots happen in a `finally` block so they're captured even on partial failure.
- **Tauri commands** (`commands.rs`, 130 LOC): file I/O and FFmpeg detection. Stable. (Will be moved into `commands/` per the new arch — same code, new home.)
- **FFmpeg export** (`export.rs`, 900 LOC): untouched and working. Don't modify during this sprint — just relocate into `export/mod.rs` if you have a quiet hour.

### Duplication / cleanup targets

These are real cleanups the codebase needs. **None are sprint deliverables** — but if you're already in the area for sprint work and the cleanup is < 30 min, fold it in. Otherwise, log it for the post-sprint follow-up branch (`chore/post-sprint-cleanup`). The UXP plugin (`plugin/`) is frozen for dev — do not touch it even if you spot duplication there.

| # | Target | What's wrong | Cleanup scope |
|---|---|---|---|
| 1 | **Triplicated function schemas** — `backend/services/providers/function_schemas.py` (575 LOC) vs `function_schemas_desktop.py` (534 LOC) | Same intents (zoom/blur/opacity/rotate) defined under different names with different parameter shapes. Already drifting (`ISSUES.md` §6). | Sprint replaces both with `tools.json` for Tauri. Backend files become irrelevant once UXP migrates (post-sprint convergence task). Don't delete yet — UXP plugin still reads them. |
| 2 | **`plugin/backend/`** | Byte-identical copy of root `backend/` but **outdated** (only has `groq_provider`, missing gemini, video, object-tracking, schemas — `ISSUES.md` §8). It's pure dead code. **Note:** the rest of `plugin/` is frozen, but this stale duplicate inside it is fair game for deletion. Verify nothing imports it before removing. | **Delete the directory.** |
| 3 | **Hardcoded `localhost:3001`** | `web/src/lib/ai/client.ts` (lines 23, 31) hardcodes the backend URL. Blocks any non-laptop deployment. | Once the FastAPI backend is removed for Tauri, this dies with it. If anything references it post-sprint, replace with env var. |
| 4 | **Object-tracking provider stub** (`backend/services/providers/object_tracking_provider.py`) | Returns `"NOT_IMPLEMENTED"` literal. TODO mentions OpenCV/MediaPipe but it never landed. | Either implement or delete the file + remove from any provider registry. Most likely: delete. |
| 5 | **Unused `actions: List[Dict[str, Any]]` field** in `backend/models/schemas.py:22` | Declared for multi-step responses; no provider populates it; `web/src/lib/ai/client.ts:79-83` normalizes it but it's always empty. | Remove the field, or implement multi-action and use it. |
| 6 | **Stale provider cache** in `backend/services/ai_service.py:14, 28-34` | `_PROVIDER_INSTANCE` is module-global with a "load once" guard. Swapping providers requires restarting the backend. | Either remove the guard (provider construction is cheap) or expose a cache-clear endpoint. |
| 7 | **Doc sprawl** — 4 READMEs (root, `web/`, `backend/`, `backend/tests/`) + `ARCHITECTURE_PLAN.md` + `MVP_STATUS.md` + `IMPLEMENTATION_EXAMPLE.md` | No "last updated" discipline. `MVP_STATUS.md` lists already-completed tasks as TODO. Multiple plans contradict the current direction. | Consolidate aspirational docs into one `ARCHITECTURE.md` post-sprint. For sprint: add a `FREEZE.md` at root pointing readers to the right doc. |
| 8 | **Unused web deps** in `web/package.json` | `shadcn`, `tw-animate-css` not imported anywhere in `src/`. `@tauri-apps/plugin-{dialog,fs,shell}` may be partially unused. | Run `depcheck` post-sprint; remove what's unused. |
| 9 | **Duplicated extension lists** in `web/src-tauri/src/commands.rs` (lines 34-35 and 60-63) | Video/audio file extensions hardcoded twice. | Sprint fixes via `shared/extensions.rs` (see new Tauri arch above). |
| 10 | **`useChat.ts` hook + dual chat-mode plumbing** | The mode dropdown (Effects / Generate) drives two separate conversation contexts. Dropdown is being deleted in Track C Day 1, so the mode plumbing inside `useChat` becomes dead code. | Track C Day 1 owner: delete the dead branches in `useChat.ts` while you're already in `ChatPanel.tsx`. |

---

## Acceptance criteria (Friday EOD)

The sprint is "done" when you can do all of the following:

1. **Open `tools.json` and see 10 tools.** Both the Rust server and the TypeScript UI read from this file — neither has its own copy.
2. **Run `chatcut --mcp` in a terminal** and connect MCP Inspector to it. You should see all 10 tools listed.
3. **Launch the app normally** and connect MCP Inspector to `http://127.0.0.1:7331`. Same 10 tools should appear.
4. **Open the app, drop a video, and chat.** Type something like "trim the first 5 seconds and add a fade-in" and watch the editor actually do it — end to end, no manual steps. Repeat for each of the three providers (Anthropic, Groq, Gemini) by switching the dropdown in settings; all three should produce the same edits without an app restart.
5. **See edit history nodes appear** after each tool call. Click one to roll back the editor to that point in time.
6. **Read the one-line summary** on each history node (generated by Haiku). It should describe what happened, not just show the tool name.
7. **Confirm the old UI clutter is gone:** no mode dropdown, no "Connected" indicator, no hardcoded example prompts. Chat is in the center. Library and timeline are thin collapsible strips.
8. **Open the Premiere Pro plugin** and confirm it still works against the legacy backend. Nothing should have regressed.
9. **Check that `README.md` and `FREEZE.md` exist** and explain where things stand + what's coming in Phase 2.

---

## Critical files (modification or creation)

**Creation (sprint):**
- `web/src-shared/tools.json` — schema source of truth
- `web/src-tauri/src/mcp/mod.rs`, `mcp/transport.rs`, `mcp/tools/introspection.rs`, `mcp/tools/mutation.rs`
- `web/src/lib/agent/tool-registry.ts`, `agent/loop.ts`, `agent/summarize.ts`, `agent/types.ts`
- `web/src/lib/agent/providers/{anthropic,groq,gemini,index}.ts` — three BYO LLM adapters behind one `LLMProvider` interface
- `web/src-tauri/src/error.rs`, `shared/extensions.rs`, `project/{mod,reader}.rs` (per new Tauri arch)
- `web/src/components/settings/ProviderPicker.tsx`
- `web/src/components/history/EditHistoryPanel.tsx`
- `web/src/components/chat/ToolCallCard.tsx`, `chat/EmptyState.tsx`
- `web/src/components/settings/ApiKeySetting.tsx`
- `FREEZE.md` (root)

**Modification (sprint):**
- `web/src-tauri/Cargo.toml` — add rmcp, tokio, schemars, tracing
- `web/src-tauri/src/lib.rs` — spawn rmcp transport in setup
- `web/src/app/page.tsx` — layout pivot, top-bar trim
- `web/src/components/chat/ChatPanel.tsx` — mode dropdown / connection indicator / welcome state removal; wire to `agent/loop.ts`
- `web/src/lib/store/editor-store.ts` — add `editHistory[]` and `rollbackToNode`
- `web/src/types/editor.ts` — add `EditNode` type

**Reuse without modification (sprint):**
- `web/src/lib/commands/command-handler.ts` — `pushUndo` snapshot mechanism
- `web/src/lib/effects/registry.ts` — `getEffectDescriptor` for `apply_effect` enum
- `web/src/lib/project/serializer.ts` — for Rust port if needed
- `web/src-tauri/src/commands.rs` — file IO, ffmpeg detection
- `web/src-tauri/src/export.rs` — FFmpeg export pipeline (untouched)

**Frozen (no edits this sprint):**
- `backend/**`
- `plugin/**`

---

## Verification

End-to-end manual test flow:

```bash
# Build
cd web && npm install
cd src-tauri && cargo build
cd .. && npm run tauri dev

# In the running app:
# 1. Settings → paste Anthropic key
# 2. Drop a video into the library
# 3. Chat: "Trim the first 5 seconds, then add a fade-in"
# 4. Confirm: 2 history nodes with one-line summaries
# 5. Click the first node → state rolls back
# 6. Cmd+Q

# External MCP client smoke
./target/debug/chatcut --mcp &  # stdio mode
npx @modelcontextprotocol/inspector ./target/debug/chatcut -- --mcp
# → list_tools shows 10 tools, call_tool get_timeline_state on a saved .chatcut file works

# Streamable HTTP smoke
npm run tauri dev  # leave running
curl http://127.0.0.1:7331/  # rmcp HTTP entrypoint responds
npx @modelcontextprotocol/inspector --transport streamable-http http://127.0.0.1:7331
```

Automated tests for this sprint are scoped narrowly:
- `web/src-tauri/src/mcp/tools/*` — unit tests for each tool handler against fixture `.chatcut` files
- `web/src/lib/agent/tool-registry.test.ts` — for each `tools.json` entry, assert the corresponding Zustand action is reachable
- `web/src/lib/store/editor-store.test.ts` — `rollbackToNode` restores tracks + playback to the snapshot

No coverage requirements. The acceptance criteria above are the bar.
