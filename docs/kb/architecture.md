# Architecture

> **Purpose:** Module map, data flow, and layer boundaries for the ChatCut Tauri editor.
> **Last touched:** 2026-05-11
> **Status:** Active

## High-level shape

ChatCut has two runtime halves: a **webview** (React/TypeScript) where chat, state, and AI live, and a **Rust process** (Tauri) that handles file I/O, FFmpeg export, and serves as an MCP server for external clients.

```
                          +--------------------------+
                          |    LLM Provider APIs     |
                          |  (Anthropic / Groq /     |
                          |   Gemini)                |
                          +------------+-------------+
                                       |  HTTPS, BYO key
  +------------------------------------+--------------------------------------+
  |  Tauri webview (TypeScript)                                                |
  |                                                                            |
  |  +------------------+     +-------------------+     +------------------+  |
  |  | agent/loop.ts    |---->| agent/tool-       |---->| store/editor-    |  |
  |  | (max 8 iter)     |     | registry.ts       |     | store.ts         |  |
  |  +------------------+     +-------------------+     | (Zustand)        |  |
  |         ^                        |                   +--------+---------+  |
  |         |                        v                            |            |
  |  +------+--------+     +-------------------+                  v            |
  |  | chat/          |     | agent/            |     +-----------+--------+   |
  |  | ChatPanel.tsx  |     | summarize.ts      |     | engine/video-      |   |
  |  | (center col)   |     | (Haiku summaries) |     | engine.ts          |   |
  |  +----------------+     +-------------------+     | (canvas render)    |   |
  |                                                    +--------------------+   |
  +----------------------------------+-----------------------------------------+
                                     |  Tauri invoke()  (file IO, FFmpeg)
  +----------------------------------+-----------------------------------------+
  |  Tauri Rust process                                                        |
  |                                                                            |
  |  +----------------+  +----------------+  +--------------------+            |
  |  | commands/       |  | export.rs      |  | mcp/               |           |
  |  | fs.rs, etc.     |  | (913 LOC,      |  | mod.rs (14 tools)  |           |
  |  | (file metadata, |  |  FFmpeg pipe)  |  | transport.rs       |           |
  |  |  dir listing)   |  |                |  | tools/introspect.. |           |
  |  +----------------+  +----------------+  | tools/mutation.rs  |            |
  |                                           +----------+---------+           |
  |  +----------------+  +----------------+              |                     |
  |  | project/        |  | ffmpeg/         |              |                    |
  |  | reader.rs       |  | catalog.rs      |              |                    |
  |  | (133 LOC)       |  | probe.rs        |              |                    |
  |  +----------------+  +----------------+              |                     |
  +------------------------------------------------------+---------------------+
                                                         |
                                          stdio / streamable-HTTP
                                                         |
                              Claude Desktop / Cursor / CLI clients
```

## Module inventory

### TypeScript (webview) — 56 files

| Module | Key files | LOC (approx) | Role |
|--------|-----------|------|------|
| **Agent loop** | `lib/agent/loop.ts` | 166 | Provider-agnostic tool-use loop, max 8 iterations |
| **Tool registry** | `lib/agent/tool-registry.ts` | 461 | Maps `tools.json` entries to Zustand actions |
| **Agent types** | `lib/agent/types.ts` | 50 | `ToolCall`, `ToolResult`, `EditNode` |
| **Agent summary** | `lib/agent/summarize.ts` | ~60 | Per-edit one-line summary via Haiku |
| **LLM providers** | `lib/agent/providers/{anthropic,groq,gemini,index}.ts` | ~400 total | BYO-key adapters behind `LLMProvider` interface |
| **Editor store** | `lib/store/editor-store.ts` | ~800 | Zustand — 4 slices: playback, project, UI, timeline |
| **Settings store** | `lib/store/settings-store.ts` | ~80 | Provider selection, API keys |
| **Video engine** | `lib/engine/video-engine.ts` | ~500 | Canvas-based preview, frame rendering |
| **Effects** | `lib/effects/registry.ts`, `ffmpeg-mapper.ts`, `transform-bridge.ts` | ~600 total | Effect catalog + FFmpeg filter mapping |
| **Recipe system** | `lib/recipe/compiler.ts`, `validator.ts` | ~200 total | FFmpeg filter-graph composition + validation |
| **Project I/O** | `lib/project/serializer.ts` | ~150 | `.chatcut` file save/load |
| **Commands** | `lib/commands/command-handler.ts` | ~250 | `executeAction()` with auto undo capture |
| **Legacy AI path** | `lib/ai/client.ts`, `action-mapper.ts` | ~400 total | Old FastAPI HTTP client (frozen, superseded by agent loop) |
| **Chat UI** | `components/chat/{ChatPanel,ChatMessage,FloatingChatPanel,ToolCallCard,EmptyState}.tsx` | ~500 total | Chat center column |
| **Editor UI** | `components/editor/{VideoPreview,TransportControls,VideoLibrary}.tsx` + `timeline/` (6 files) + `export/` | ~1200 total | Preview, transport, library, timeline, export dialog |
| **History UI** | `components/history/EditHistoryPanel.tsx` | ~150 | Linear edit history with rollback |
| **Settings UI** | `components/settings/{ProviderPicker,ApiKeySetting}.tsx` | ~200 total | Provider dropdown + key input |
| **Shared schema** | `src-shared/tools.json` | 230 | Schema source of truth — 17 tools (8 introspection, 9 mutation) |

### Rust (Tauri process) — 19 files, ~4,200 LOC

| Module | Key files | LOC | Role |
|--------|-----------|-----|------|
| **Entry** | `main.rs`, `lib.rs` | 6, 99 | Tauri builder, module wiring, MCP transport spawn |
| **MCP server** | `mcp/mod.rs` | 420 | `ChatCutServer` struct, 14 `#[tool]` handlers (`add_clip` absent — see `current-state.md` MCP section) |
| **MCP transport** | `mcp/transport.rs` | 48 | stdio + streamable-HTTP wiring |
| **MCP tools** | `mcp/tools/{introspection,mutation}.rs` | 155, 203 | Read-only + write tool implementations |
| **Commands** | `commands.rs` | 168 | Tauri commands for webview (file metadata, dir listing, FFmpeg detect) |
| **Export** | `export.rs` | 913 | FFmpeg pipeline — filter graph, codec args, progress parsing |
| **Project** | `project/{mod,reader}.rs` | 3, 133 | `.chatcut` file I/O shared with MCP |
| **FFmpeg** | `ffmpeg/{mod,catalog,probe}.rs` | 2, 162, 298 | Filter catalog + media probing |
| **Recipe** | `recipe/{mod,validator}.rs` | 293, 41 | FFmpeg recipe validation |
| **Shared** | `shared/{mod,extensions}.rs` | 1, 11 | Canonical video/audio extension lists |
| **Error** | `error.rs` | 22 | Typed errors (thiserror) |

### Legacy (frozen)

| Path | Stack | Status |
|------|-------|--------|
| `backend/` | Python, FastAPI, Gemini/Groq | Frozen — serves UXP plugin only |
| `plugin/` | React (UXP), Webpack | Frozen — Premiere Pro panel |
| `plugin/backend/` | Dead copy of `backend/` | Should be deleted (`ISSUES.md` §8) |

## Data flow: chat message to editor mutation

```
User types "trim the first 5 seconds"
  |
  v
ChatPanel.tsx  -->  runAgentLoop()        (lib/agent/loop.ts:33)
  |                    |
  |                    v
  |              provider.streamTurn()    (e.g. providers/anthropic.ts)
  |                    |
  |                    v
  |              LLM returns tool_use:
  |              { name: "trim_clip", arguments: { source_start: 5 } }
  |                    |
  |                    v
  |              executeTool()            (tool-registry.ts:32)
  |                    |
  |                    v
  |              beginUndoBatch()  ->  Zustand: trimClipStart()  ->  commitUndoBatch()
  |                    |                (editor-store.ts)
  |                    v
  |              addEditNode()  ->  summarizeEditNode()  (summarize.ts)
  |                    |
  |                    v
  |              ToolResult returned to loop  ->  next iteration or final text
  |
  v
ChatPanel renders assistant text + ToolCallCard(s)
EditHistoryPanel shows new node with one-line summary
VideoEngine re-renders canvas from updated store state
```

## Data flow: external MCP client

```
Claude Desktop connects via stdio or streamable-HTTP
  |
  v
mcp/transport.rs  -->  ChatCutServer    (mcp/mod.rs)
  |                         |
  |                         v
  |                    #[tool] handler matches tool name
  |                         |
  |              +----------+----------+
  |              |                     |
  |        introspection          mutation
  |              |                     |
  |              v                     v
  |        project::reader.rs    project::write_project()
  |        reads .chatcut file   mutates .chatcut on disk
  |              |                     |
  |              v                     v
  |        returns JSON          returns success/error
  |
  v
MCP client receives tool result
```

## Key boundaries

1. **Webview <-> Rust:** Only via `tauri::invoke()` for file I/O and FFmpeg. Chat and AI never cross this boundary.
2. **Agent loop <-> Store:** Tool registry is the only bridge. Tools call Zustand actions; the loop never reads/writes the store directly.
3. **MCP <-> Project file:** External MCP clients operate on the saved `.chatcut` file, not the live in-memory store. Phase 2 will add an event bridge for live edits.
4. **Provider adapters <-> Agent loop:** Providers are interchangeable via the `LLMProvider` interface. The loop doesn't know which model is running.
