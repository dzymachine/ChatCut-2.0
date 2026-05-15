# ChatCut Backend → MCP Server Migration

**Status:** Approved (brainstorming complete, sections 1–2 reviewed live; sections 3–7 derived from approved Q1–Q5 decisions and the architecture revision in section 1).
**Author:** prepared with Claude in collaboration with @pronei
**Deadline:** 2026-05-15 (hard)
**Spec date:** 2026-04-22

---

## 1. Goal

Replace ChatCut's bespoke FastAPI backend with an MCP server that:

1. Exposes a single canonical, NLE-agnostic tool registry that LLMs (Claude/Gemini/Groq) consume in their native tool-use formats.
2. Adds a first-class **Claude provider** that uses Anthropic's tool use loop with prompt caching.
3. Keeps the two existing clients (UXP plugin, Tauri/Next.js desktop) working through and after the migration with minimal client-side change.
4. Sets up FinalCut and other future NLEs as a "new capability profile + new client adapter" change rather than an architectural rewrite.

This is a **migration**, not a rewrite. Every existing endpoint keeps working until both clients have moved over.

---

## 2. Non-goals (explicit out-of-scope for the May 15 deadline)

- WebSocket / SSE streaming of LLM responses to clients. (Stays on the post-deadline list — `/api/turn` is request/response.)
- Server-side tool execution. All 14 LLM-facing tools are **client-executed**; the server only declares schemas and routes calls.
- Surfacing Runway / Colab / object-tracking integrations as MCP tools (defer; rename folder only — Q5 answer **B**).
- Rewriting the Tauri editor's ffmpeg pipeline (separate track — see Section 14 appendix; informational only, not on the May 15 critical path).
- New client features beyond plumbing the multi-turn tool loop.
- Production-quality observability (we'll ship structlog + a request id; no APM/metrics).
- Auth / multi-user / rate-limiting on `/api/turn` (single-user local backend).

---

## 3. Decisions locked from brainstorming

| # | Question | Decision |
|---|---|---|
| 1 | North star | **C** — replace bespoke backend with an MCP server |
| 2 | Migration shape | **B** — MCP server with HTTP + stdio dual transport, both clients alive |
| 3 | Tool surface for May 15 | **B** — port the existing 9 mutations + add 5 read-only introspection tools |
| 4 | Multi-turn loop ownership | **B** — client-driven, stateless server, leverage Claude prompt caching |
| 5 | Non-LLM "providers" scope | **B** — folder hygiene rename only (`llm/` + `integrations/`), no behavior change |

These five decisions are the load-bearing ones; everything else in this spec is either implied by them or is a finer-grained design call.

---

## 4. Architecture & Data Flow

```
                          ┌────────────────────────────┐
                          │     Tool Registry          │
                          │  ┌──────────────────────┐  │
                          │  │ Canonical tool defs  │  │
                          │  │ (NLE-agnostic)       │  │
                          │  └──────────────────────┘  │
                          │  ┌──────────────────────┐  │
                          │  │ Capability profiles  │  │
                          │  │  • premiere (seeded  │  │
                          │  │    from MIT vendor)  │  │
                          │  │  • chatcut           │  │
                          │  │  • fcp     [stub]    │  │
                          │  │  • davinci [stub]    │  │
                          │  └──────────────────────┘  │
                          └─────────────┬──────────────┘
                                        │  filter(client_type)
                                        ▼
┌──────────────────┐    ┌─────────────────────────────┐    ┌──────────────────┐
│ HTTP /api/turn   │───►│       Turn Orchestrator     │◄───│ stdio MCP        │
│ (UXP, Tauri now) │    │  (provider-agnostic, returns│    │ (future Tauri    │
└──────────────────┘    │   canonical tool calls)     │    │  native, CLI)    │
                        └──────────────┬──────────────┘    └──────────────────┘
                                       ▼
                  ┌────────────────────┴───────────────────┐
                  │     LLM Provider Adapter               │
                  │   ┌─────────┬─────────┬─────────┐      │
                  │   │ Claude  │ Gemini  │ Groq    │      │
                  │   │ (tool   │ (func   │ (tool   │      │
                  │   │  use +  │  call)  │  call)  │      │
                  │   │  cache) │         │         │      │
                  │   └─────────┴─────────┴─────────┘      │
                  └────────────────────────────────────────┘
                                       │
              canonical tool calls (e.g., split_clip(clip_id=X, frame=120))
                                       │
              ┌────────────────────────┴────────────────────────┐
              ▼                                                 ▼
    ┌──────────────────┐                            ┌─────────────────────┐
    │  UXP plugin      │                            │  Tauri / Next.js    │
    │  Premiere adapter│                            │  ChatCut adapter    │
    │  (canonical →    │                            │  (canonical →       │
    │   matchName)     │                            │   editor internals) │
    └──────────────────┘                            └─────────────────────┘
```

### 4.1 Per-turn flow (client-driven, stateless server)

1. Client (UXP or Tauri) sends `POST /api/turn` with `{messages, tool_results, client_type, provider_hint?}`.
2. Server resolves the **capability profile** for `client_type` and filters the canonical tool registry to that profile's supported tools.
3. Server picks the LLM provider (env default, overridable via `provider_hint`), translates the canonical tool schemas to that provider's format via an adapter.
4. Server calls the provider's async tool-use API.
5. Provider returns either a **terminal text answer** or **one-or-more tool calls**.
6. Server emits canonical tool-call envelopes back to the client (translating from Claude/Gemini/Groq response format).
7. Client either renders the answer (done) or executes each tool call locally via its NLE adapter (UXP API or Tauri/editor internals) and POSTs back with `tool_results` populated. Loop until step 5 returns text.

### 4.2 Server invariants

- **Stateless.** No session storage, no in-memory conversations. Full `messages` list rehydrated per request. Conversation truncation (drop oldest user/assistant pair to fit context) happens at the orchestrator boundary, not silently inside providers.
- **Client-side execution.** None of the 14 LLM-facing tools execute on the server. Their MCP `Tool` handlers (when accessed via the stdio transport) return a `client_executes` marker that the MCP client unwraps locally.
- **Single source of truth for schemas.** Canonical tool defs are the only authoritative shape; all provider-facing schemas are mechanically derived via adapters. No hand-maintained per-provider schemas.
- **Prompt caching.** Claude provider places the cache breakpoint after `system_prompt + tool_definitions`. For Gemini/Groq, no caching (out of scope; available only on Claude). The system prompt + tool block is ~95% of input tokens for short user messages; cache reads are 10% of normal input cost.

### 4.3 What this preserves vs. today

- Per-call HTTP shape; clients keep using HTTP.
- The `messages[]` history pattern.
- All legacy endpoints (during the transition window).
- Redis cache (now keyed including provider id).

### 4.4 What this changes

- One `/api/turn` endpoint subsumes both `/api/process-prompt` and `/api/ask-question` — Claude (and Gemini, and Groq) all decide whether the answer is text or a tool call. Legacy endpoints keep working, internally routed through the new orchestrator.
- The `client_type` field becomes meaningful: it selects a capability profile, not a code path.
- Adding a new NLE = adding a profile module + a client-side adapter; **no orchestrator or provider changes**.

---

## 5. Project Layout

```
backend/
├── pyproject.toml                 # PEP 621, replaces requirements.txt; uv-managed
├── .python-version                # 3.12
├── ruff.toml + mypy.ini
│
├── chatcut_backend/
│   ├── __init__.py
│   ├── settings.py                # pydantic-settings.BaseSettings, typed env
│   ├── exceptions.py              # ProviderError, RateLimitError, ToolError, ...
│   ├── logging.py                 # structlog config
│   │
│   ├── transports/
│   │   ├── http.py                # FastAPI app: /api/turn + legacy shims
│   │   └── stdio_mcp.py           # MCP SDK server over stdio
│   │
│   ├── orchestrator/
│   │   ├── turn.py                # async run_turn(ctx, msgs, tool_results) -> Step
│   │   └── types.py               # Pydantic models: Step, ToolCall, ToolResult
│   │
│   ├── registry/
│   │   ├── canonical.py           # canonical NLE-agnostic tool definitions
│   │   ├── filters.py             # filter_for_profile(profile_id) -> tools
│   │   └── profiles/
│   │       ├── premiere.py        # Premiere capability profile
│   │       │   (seeded from MIT premiere-pro-mcp vendor)
│   │       ├── chatcut.py         # ChatCut desktop profile
│   │       │   (auto-generated from web/effects.json once it exists)
│   │       ├── fcp.py             # stub for future
│   │       └── _vendor/
│   │           └── premiere-pro-mcp/   # vendored schemas + LICENSE
│   │
│   ├── llm/
│   │   ├── base.py                # AsyncLLMProvider protocol
│   │   ├── claude.py              # NEW — anthropic SDK + tool use + caching
│   │   ├── gemini.py              # rewritten thin: schema adapter + run_turn
│   │   ├── groq.py                # rewritten thin: schema adapter + run_turn
│   │   └── _shared/
│   │       ├── retry.py           # backoff + typed RateLimitError handling
│   │       ├── cache.py           # provider-aware cache key (was redis_cache)
│   │       └── tool_adapters.py   # canonical schema → claude/gemini/groq formats
│   │
│   ├── integrations/
│   │   ├── runway.py              # was video_provider.py
│   │   ├── colab.py               # was colab_proxy.py
│   │   └── object_tracking.py
│   │
│   ├── api/
│   │   ├── turn.py                # POST /api/turn
│   │   ├── legacy.py              # /api/process-prompt, /api/ask-question, etc.
│   │   ├── integrations.py        # /api/process-media, /api/colab-*
│   │   └── health.py
│   │
│   └── prompts/
│       ├── system_action.md       # tool-use system prompt
│       ├── system_question.md     # Premiere Q&A system prompt (legacy support)
│       └── README.md              # how to edit / version prompts
│
└── tests/
    ├── conftest.py
    ├── unit/                      # registry, adapters, cache key, retry
    ├── providers/                 # one file per provider, contract tests
    ├── integration/               # /api/turn end-to-end with mock LLMs
    └── golden/                    # canonical schema → per-provider format snapshots
```

### 5.1 Key relocations from today

| From | To | Notes |
|---|---|---|
| `backend/main.py` | `chatcut_backend/transports/http.py` | Run via `uvicorn chatcut_backend.transports.http:app` |
| `services/providers/gemini_provider.py` (542 lines) | `chatcut_backend/llm/gemini.py` (~150) | Loses retry, cache, defaults, schema adaptation (now in `_shared/` and `registry/`) |
| `services/providers/groq_provider.py` (529 lines) | `chatcut_backend/llm/groq.py` (~150) | Same |
| `services/providers/function_schemas{,_desktop}.py` (1109 lines combined) | `chatcut_backend/registry/profiles/{premiere,chatcut}.py` | Most lines absorbed by canonical registry; profiles become per-NLE filter + id-translation tables |
| `services/providers/{video,colab,object_tracking}_provider.py` | `chatcut_backend/integrations/{runway,colab,object_tracking}.py` | Folder rename only (Q5 decision B) |
| `services/providers/redis_cache.py` | `chatcut_backend/llm/_shared/cache.py` | Cache key now includes provider id and tool registry hash |
| `models/schemas.py` (one big file) | Split: `orchestrator/types.py` for new Step/ToolCall/ToolResult; per-route file under `api/` for request/response | |
| `services/ai_service.py` (the `_get_provider` global, color-preprocess, action registry dict) | Deleted. Color preprocessing → ChatCut presets (frontend); `_get_provider` → DI; action registry → canonical registry. | |
| Hardcoded system prompts inside provider classes | `chatcut_backend/prompts/*.md` | Loaded at startup; can be edited / A/B tested without code changes |

### 5.2 Backwards-compat strategy

Every legacy endpoint keeps returning the same response shape it does today. Internally, it builds a synthetic `messages` array, calls `run_turn`, and converts the result back to the legacy format. The behavior is consistent between old and new endpoints because they share the same orchestrator and provider stack. A follow-up PR after May 15 deletes `api/legacy.py` once both clients have switched to `/api/turn`.

---

## 6. Tool registry & schema sourcing

### 6.1 Canonical tool definition (single source of truth)

```python
# chatcut_backend/registry/canonical.py
from typing import Literal
from pydantic import BaseModel

class ToolParam(BaseModel):
    name: str
    type: Literal["string", "number", "integer", "boolean", "array", "object"]
    description: str
    required: bool = False
    default: object | None = None
    enum: list[str] | None = None
    items: dict | None = None  # for arrays

class CanonicalTool(BaseModel):
    name: str                     # snake_case, NLE-agnostic (split_clip, get_selected_clips)
    description: str              # written for the LLM, not the user
    category: Literal["mutation", "introspection", "meta"]
    params: list[ToolParam]
    returns: str | None = None    # description of what the tool returns to the LLM (introspection only)
    examples: list[str] = []      # natural-language requests that should call this tool
```

### 6.2 The 14 tools (May-15 surface)

**Mutations (9 — port of existing actions):**
1. `zoom_in` (was `zoomIn`)
2. `zoom_out` (was `zoomOut`)
3. `apply_filter` (was `applyFilter`)
4. `apply_transition` (was `applyTransition`)
5. `apply_blur` (was `applyBlur`)
6. `modify_parameter` (was `modifyParameter`)
7. `apply_audio_filter` (was `applyAudioFilter`)
8. `adjust_volume` (was `adjustVolume`)
9. `ask_clarification` (was `askClarification`; technically a meta-tool but kept here for parity)

**Introspection (5 — new):**
10. `get_selected_clips` — returns array of clip ids and basic metadata
11. `get_clip_parameters` — given a clip id, returns currently-applied effects + their params
12. `get_active_sequence_info` — sequence dimensions, fps, duration, track count
13. `get_playhead_position` — current playhead in seconds and frames
14. `list_applied_effects` — given a clip id, list of effects with display names

Note: `getParameters` (the existing tool) is dropped in favor of the more specific introspection tools above. The legacy endpoint keeps the old behavior for the transition window.

### 6.3 Capability profiles

```python
# chatcut_backend/registry/profiles/chatcut.py
from chatcut_backend.registry.canonical import CANONICAL_TOOLS

CHATCUT_PROFILE = {
    "id": "chatcut",
    "supported": {  # canonical_name -> chatcut effect id (or None if name matches)
        "zoom_in": "scale",
        "zoom_out": "scale",
        "apply_filter": None,        # name passes through
        "apply_blur": "gaussian_blur",
        # ... etc
        "get_selected_clips": None,
        "get_clip_parameters": None,
        # ...
    },
    # tools the LLM should NEVER see for this NLE:
    "excluded": {"apply_audio_filter"},  # placeholder example
}
```

A profile is a small data file. It does **not** redefine the schema — it picks tools and provides id translation hints. The canonical schema is what the LLM sees; the client-side adapter handles translation from canonical to NLE-native.

### 6.4 Translation and serialization

- **canonical → Claude** (`tool_adapters.canonical_to_claude(tools) -> list[dict]`): produces the `{"name", "description", "input_schema": {"type": "object", "properties": ..., "required": [...]}}` shape Anthropic expects.
- **canonical → Gemini** (`tool_adapters.canonical_to_gemini(tools) -> list[dict]`): produces `{"function_declarations": [{"name", "description", "parameters": {...}}]}`.
- **canonical → Groq/OpenAI** (`tool_adapters.canonical_to_groq(tools) -> list[dict]`): produces `{"type": "function", "function": {"name", "description", "parameters": {...}}}`.
- **canonical → MCP `Tool`** (`tool_adapters.canonical_to_mcp(tools) -> list[mcp.Tool]`): for the stdio transport.

Each adapter has a golden snapshot test (`tests/golden/`) so any change to canonical schemas surfaces as a deliberate snapshot diff per adapter.

### 6.5 Vendoring the premiere-pro MCP schemas (MIT)

- Copy the upstream tool schemas into `registry/profiles/_vendor/premiere-pro-mcp/`.
- Preserve their LICENSE file at the same path; preserve copyright headers per file.
- The `premiere.py` profile imports from the vendor module and re-exports the supported subset, marking each tool as supported/unsupported based on what the UXP plugin actually implements.
- README in `_vendor/` lists upstream URL, commit SHA at vendor time, and which files were copied.

The vendor lives behind the profile boundary — orchestrator and providers don't know it exists.

---

## 7. Provider interface

### 7.1 Async protocol

```python
# chatcut_backend/llm/base.py
from typing import Protocol
from chatcut_backend.orchestrator.types import Step, Message, ToolResult

class AsyncLLMProvider(Protocol):
    name: str  # "claude", "gemini", "groq"

    async def is_configured(self) -> bool: ...

    async def run_turn(
        self,
        messages: list[Message],
        tools: list[CanonicalTool],
        tool_results: list[ToolResult] | None = None,
        system_prompt: str | None = None,
        cache: bool = True,  # Claude only; ignored elsewhere
    ) -> Step:
        """One LLM turn: returns either a terminal text answer or a list of tool calls."""
```

### 7.2 The `Step` return shape

```python
# chatcut_backend/orchestrator/types.py
class ContentBlock(BaseModel):
    """Provider-neutral block for interleaved text + tool_use within an assistant message."""
    type: Literal["text", "tool_use", "tool_result"]
    text: str | None = None
    tool_use_id: str | None = None    # set when type == "tool_use" or "tool_result"
    tool_name: str | None = None      # set when type == "tool_use" (canonical name)
    input: dict | None = None         # set when type == "tool_use"
    output: dict | str | None = None  # set when type == "tool_result"
    is_error: bool = False            # set when type == "tool_result"

class Message(BaseModel):
    role: Literal["user", "assistant", "tool_result"]
    content: str | list[ContentBlock]  # plain string for simple turns; block list for tool-use rounds

class ToolCall(BaseModel):
    id: str            # provider-issued id; opaque to us
    name: str          # canonical tool name
    arguments: dict    # already-validated against the canonical param schema

class ToolResult(BaseModel):
    tool_call_id: str
    output: dict | str  # the canonical-shape return value
    is_error: bool = False

class Step(BaseModel):
    type: Literal["answer", "tool_calls"]
    answer: str | None = None              # set when type == "answer"
    tool_calls: list[ToolCall] | None = None  # set when type == "tool_calls"
    usage: UsageInfo | None = None         # tokens, cache hits, model id
```

### 7.3 What lives in `_shared/`

- **`retry.py`** — async exponential backoff with jitter; takes a typed exception hierarchy (`RateLimitError`, `TransientError`, `ProviderError`) and decides retry vs. raise. Each provider raises typed exceptions; substring matching against stringified errors is gone.
- **`cache.py`** — async Redis cache. Key includes the provider name, model id, registry hash, and a normalized prompt — so swapping providers or adding tools invalidates appropriately. Key-only failure paths are silent (cache stays optional).
- **`tool_adapters.py`** — pure functions, no I/O. Tested via golden snapshots.

### 7.4 Defaults move out of providers

The current `_apply_defaults` is duplicated in every provider. Defaults belong on the canonical tool param (`ToolParam.default`). The orchestrator validates and fills defaults before any provider sees the call args, so providers stop carrying that logic.

---

## 8. Claude provider specifics

### 8.1 Stack

- `anthropic>=0.40` (current as of 2026-04 with tool use + caching support)
- `AsyncAnthropic` client; configured once, reused
- Default model: `claude-sonnet-4-7` (env-overridable via `CLAUDE_MODEL`)
- Default `max_tokens`: 1024 for tool turns, 800 for question/answer turns

### 8.2 Tool use loop (single-turn from server's perspective)

The server runs *one* Claude API call per `/api/turn` request. Multi-step reasoning happens because the client posts back tool results in a follow-up `/api/turn`. This matches our Q4 decision (client-driven loop, stateless server).

```python
async def run_turn(self, messages, tools, tool_results, system_prompt, cache):
    anthropic_messages = self._to_anthropic_messages(messages, tool_results)
    anthropic_tools = canonical_to_claude(tools)

    system_blocks = [{
        "type": "text",
        "text": system_prompt,
        # cache breakpoint AFTER system + tools, BEFORE messages
        "cache_control": {"type": "ephemeral"} if cache else None,
    }]

    response = await self.client.messages.create(
        model=self.model,
        max_tokens=self.max_tokens,
        system=system_blocks,
        tools=anthropic_tools,  # cached as part of the system block via SDK's behavior
        messages=anthropic_messages,
    )

    return self._to_step(response)
```

### 8.3 Cache placement (the load-bearing detail)

Anthropic's prompt caching has minimum-token requirements (1024 for Sonnet at time of writing) and a 5-minute TTL. The cache breakpoint is placed at the boundary between `system_prompt + tools` and the conversation `messages`. This means:

- First request: full encode of system + tools (paying full price for ~3-5k tokens of tool schemas).
- Subsequent requests within 5 min: 90% discount on that 3-5k token chunk.

The conversation-history portion is not cached because it changes every turn. For long conversations, we may add a second breakpoint after the first user message; deferred until measured to be a problem.

### 8.4 Error handling

Provider raises typed exceptions (`anthropic.RateLimitError`, `anthropic.APIStatusError`, etc.) directly. The shared `retry.py` knows how to handle each. Stringified-error substring matching is gone.

### 8.5 What Claude can do that Gemini/Groq can't (deferred for May 15)

- Extended thinking (Claude's reasoning blocks) — UI doesn't surface them yet; trivial to enable later.
- Computer use — out of scope; would need the agent to execute its own tools.
- Streaming — out of scope per non-goals.

---

## 9. MCP server (transports)

### 9.1 HTTP transport (primary, both clients use this)

- FastAPI app in `transports/http.py`.
- Single new endpoint: `POST /api/turn` accepting `{messages, tool_results?, client_type, provider_hint?}`, returning a `Step`.
- All legacy endpoints (`/api/process-prompt`, `/api/process-media`, `/api/process-object-tracking`, `/api/colab-*`, `/api/ask-question`) continue to exist via `api/legacy.py` and are internally routed through `run_turn`.
- CORS unchanged for transition (`allow_origins=["*"]`); narrowed to `localhost` in a follow-up.

### 9.2 stdio MCP transport (secondary, future Tauri-native)

- `transports/stdio_mcp.py` uses the official `mcp` Python SDK (`mcp.server.Server`) with the stdio transport.
- Registers all canonical tools as `mcp.Tool` via `canonical_to_mcp`.
- Tool `handler` functions are stubs that return a `client_executes` marker — actual execution is on whoever speaks to the stdio server. (For May 15 this is a CLI tool / smoke test; Tauri-native consumption is post-deadline.)
- Run via `python -m chatcut_backend.transports.stdio_mcp`.

### 9.3 The two transports share

- The orchestrator (`run_turn`) and everything below it.
- The tool registry.
- The provider stack.

The transports are thin and only differ in framing (HTTP request/response vs. JSON-RPC over stdio).

### 9.4 Health and debugging

- `GET /health` reports configured providers, tool registry hash, vendor sha, redis status.
- `GET /api/debug/tools?profile=premiere&provider=claude` returns the rendered tool schema for that profile + provider — for verifying the adapter pipeline without round-tripping through the LLM. Disabled in production via env flag.

---

## 10. Client multi-turn loop changes

Both clients need the same conceptual change: handle the case where `/api/turn` returns `type=tool_calls` instead of `type=answer`.

### 10.1 UXP plugin

- Existing `actionDispatcher.js` already maps action names to UXP API calls. Wire the new tool names (snake_case canonical) to the same dispatcher; canonical→UXP id translation (e.g., `apply_filter` matchName lookup) lives client-side.
- Add a tiny loop runner: `for (;;) { step = await POST(/api/turn, {messages, tool_results}); if (step.type === 'answer') break; tool_results = await runAll(step.tool_calls); messages.push(...) }`.
- Cap loop iterations (e.g., 8) with a soft warning to the user.
- Tool calls that fail in UXP return `is_error: true` to the next turn; Claude/Gemini/Groq are good at recovering from this.

### 10.2 Tauri desktop

- Same loop runner in TypeScript.
- Tool execution dispatches through the existing effect/timeline state stores; no Rust changes needed for the May 15 surface (the 9 mutations + 5 introspection tools are all expressible via existing TS-side state APIs).
- Future: Tauri can move from HTTP to stdio MCP by spawning the backend as a sidecar; the loop runner is the same shape, only the transport differs.

### 10.3 Backwards-compat path

Both clients keep their existing call sites for `/api/process-prompt` and `/api/ask-question` working. The new `/api/turn` is opt-in per-call; we migrate one call site at a time. The legacy paths will share an orchestrator and produce the same answers, so behavior parity is automatic.

---

## 11. Migration steps (high-level; implementation plan has sub-tasks)

The implementation plan (`2026-04-22-backend-mcp-migration-plan.md`, written next) breaks these into ordered sub-tasks. This section is the milestone view.

| Wk | Milestone | Exit criterion |
|---|---|---|
| 0 (in progress) | Spec + plan committed; planning worktree pushed | This file lands on `chore/backend-mcp-migration-plan` |
| 1 | Package skeleton + canonical registry + adapters + golden snapshots | `pytest tests/unit tests/golden` green; old endpoints still pass `tests/test_api_endpoints.py` |
| 2 | Claude provider; Gemini + Groq providers rewritten thin against new shape | All provider contract tests pass; `/health` shows three configured providers; cache invalidates per-provider |
| 3 | `POST /api/turn` HTTP endpoint; both clients ship their loop runner; introspection tools wired client-side | `/api/turn` end-to-end with each provider; both clients exercise tool loop in a smoke test |
| 4 (buffer) | stdio MCP transport; vendored Premiere schemas; Tauri sidecar smoke test; legacy endpoint sunset planning | `python -m chatcut_backend.transports.stdio_mcp` registers all canonical tools; one Tauri end-to-end run via stdio |

A 4-day buffer at the end of week 4 absorbs slippage. If we hit it, item 4's stdio transport is deferred (its primary value is post-deadline anyway), keeping the HTTP path on schedule.

---

## 12. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Anthropic SDK version drift (tool use + caching API changes) | low | Pin `anthropic` minor version; smoke test on bump |
| Both clients can't ship loop runner in one week | medium | Loop runner is ~50 lines per client; UXP and Tauri can be done in parallel by different people. If only one ships, the other keeps using legacy endpoints — no regression. |
| Vendored premiere-pro-mcp schemas drift from upstream | low | Pin upstream commit SHA; document refresh process; vendor refresh isn't on the May-15 path |
| Prompt caching doesn't deliver the promised cost savings | low | Measure on day 1 of week 2; if disappointing, drop the cache breakpoint — costs go up but functionality unchanged |
| MCP Python SDK API changes mid-migration | low | The SDK is stable as of late 2025; pin minor version |
| Loop runner causes infinite loops if LLM oscillates | medium | Hard cap at 8 iterations per `/api/turn` chain; warn user if hit |
| New `/api/turn` shape is wrong for some legacy use case | medium | Keep all legacy endpoints alive; we can iterate on `/api/turn` for several weeks before forcing the cutover |

---

## 13. Open questions (defer beyond May 15)

- **Streaming.** When do we add SSE/WebSocket and to which client first? Likely Tauri, since SSE is trivial in the renderer; UXP follows when we have the appetite.
- **Server-side tool execution.** When (if ever) does the backend host its own MCP-tool implementations vs. always proxying to the client?
- **Multi-user / auth.** Currently single-user / local. If we ever host the backend remotely, we need auth + per-user keys + rate limiting.
- **Observability.** structlog gets us logs; do we add a metrics backend? Probably only when there are real users.
- **Tauri ffmpeg cleanup.** Tracked separately (see Section 14 appendix); architecturally orthogonal to backend MCP migration but unblocks the `chatcut` profile auto-generation story.

---

## 14. Appendix — Tauri ffmpeg cleanup (informational, separate track)

This appendix captures the brainstorming-time discussion of the Tauri editor's ffmpeg architecture. It is **not part of the May 15 MCP migration**; it's the rough outline for a parallel cleanup track that the user can pick up independently, with no scope conflict (different files, different repos within the monorepo).

Suggested near-term wins, in priority order, none blocking May 15:

1. Promote `EffectDescriptor` JSON to a single source of truth shared by `web/` (TS) and `web/src-tauri/` (Rust) — kills the duplicated effect-data definitions.
2. Add `ffmpeg_template` strings to each effect; both TS and Rust mappers become small substituters; bespoke builders stay only where genuinely needed.
3. Add a `custom_ffmpeg` escape-hatch effect: one effect descriptor with a free-text ffmpeg filter string param. Unlocks the entire ffmpeg filter library (~400 filters) for power users *and* for the LLM via the registry.
4. First-class preset format: `web/src/lib/presets/Preset` type, `presets/builtin/*.json` shipping the cinematic/dramatic/warm presets currently hardcoded in `backend/services/ai_service.py`. Removes the language-locked keyword preprocessing from the backend.
5. Modernize Tauri Rust deps (`anyhow`, `thiserror`, `tracing`, `tauri-plugin-log`); enable `clippy::pedantic` in CI.

Once item 1 lands, the `chatcut` capability profile in the backend MCP refactor can be auto-generated from the same JSON, completing the single-source-of-truth story across all three consumers (TS frontend, Rust export, Python LLM tooling).

---

## 15. Acceptance criteria (May 15)

The migration is "done" for the deadline when:

1. `POST /api/turn` accepts `{messages, tool_results?, client_type, provider_hint?}` and returns a typed `Step`.
2. All three providers (Claude, Gemini, Groq) implement the async `AsyncLLMProvider` protocol; `/health` reports all three configured.
3. Canonical registry exports the 14 tools (9 mutations + 5 introspection); all three provider adapters have golden-snapshot tests.
4. Both clients have a working multi-turn loop runner using `/api/turn` for at least one call site each (the others can stay on legacy).
5. All existing tests in `backend/tests/` still pass against the new code paths (legacy endpoints route through the new orchestrator).
6. `python -m chatcut_backend.transports.stdio_mcp` starts and serves the canonical tools list (smoke test only; no client consumes it yet).
7. README documents how to add a new NLE profile and how to vendor-refresh the premiere-pro-mcp schemas.
