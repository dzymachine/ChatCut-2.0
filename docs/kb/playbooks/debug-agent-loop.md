# Playbook: Debug the Agent Loop

> **Purpose:** How to diagnose when the chat-to-edit pipeline doesn't work as expected.
> **Last touched:** 2026-05-11
> **Status:** Active

## Symptom → Check map

### "The agent doesn't call any tools"

1. **Check the provider connection.** Open browser devtools → Network tab. Look for requests to the LLM provider API. If 401/403, the API key is wrong or expired.
   - Keys stored in `localStorage` (web) or OS keychain (Tauri desktop).
   - Settings: `web/src/components/settings/ApiKeySetting.tsx`.

2. **Check the system prompt.** The agent loop sends `tools.json` tool definitions as the tool schema. If the schema is malformed, the LLM won't use tools.
   - Tool schema: `web/src-shared/tools.json`.
   - Provider adapter: `web/src/lib/agent/providers/{anthropic,groq,gemini}.ts`.

3. **Check the model.** Some models handle tool use better than others. Anthropic (claude-sonnet-4-7) is the default and most reliable. Groq/Gemini may need different prompting.

### "The tool is called but nothing happens"

1. **Check the tool registry.** Does a handler exist for the tool name?
   - `web/src/lib/agent/tool-registry.ts` — look for the tool name in `TOOL_HANDLERS`.

2. **Check the Zustand action.** Is the corresponding store action being called?
   - Add `console.log` in the handler before the Zustand call.
   - `web/src/lib/store/editor-store.ts` — find the action implementation.

3. **Check `clip_id` resolution.** If `clip_id` is omitted, the handler falls back to `ui.selectedClipIds[0]`. If no clip is selected, the tool silently does nothing.
   - Verify: `useEditorStore.getState().ui.selectedClipIds` in console.

### "The tool errors out"

1. **Read the toast.** Error messages surface via `showToast("error", msg)`.

2. **Read the console.** Tool errors are logged with `[ToolRegistry]` or `[AgentLoop]` prefixes.

3. **Check the ToolCallCard.** In the chat, expand the tool call card to see the raw arguments and result. Look for `{ success: false, error: "..." }`.

### "The edit happens but undo doesn't work"

1. **Check undo batch wiring.** The tool should call `beginUndoBatch()` before and `commitUndoBatch()` after the mutation. Exception: `add_clip` manages its own undo (`tool-registry.ts:11-13`).

2. **Check for double-bookkeeping.** Some Zustand actions push their own undo entry. If the tool also wraps in a batch, Cmd+Z takes two presses.

### "External MCP client can't see the tool"

1. **Check the Rust handler exists.** `web/src-tauri/src/mcp/mod.rs` — look for `#[tool(name = "your_tool_name")]`.

2. **Test with MCP Inspector:** `npx @modelcontextprotocol/inspector` → connect → list tools.

3. **Check transport.** stdio mode: `chatcut --mcp`. HTTP mode: `http://127.0.0.1:7331`.

## Logging

- Browser console: `[ChatPanel]`, `[AgentLoop]`, `[ToolRegistry]`, `[VideoEngine]` prefixes.
- Rust: `tracing` crate (if wired). Check `RUST_LOG=debug` env var.
- LLM requests: visible in browser Network tab (Anthropic, Groq, Gemini endpoints).
