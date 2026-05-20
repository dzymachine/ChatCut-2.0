# Playbook: Add a New Tool

> **Purpose:** Step-by-step recipe for adding a new tool to ChatCut.
> **Last touched:** 2026-05-11
> **Status:** Active

## Prerequisites

- Understand the tool types: `introspection` (read-only) vs `mutation` (modifies state).
- Know which Zustand action(s) the tool will call, or plan to create new ones.

## Steps

### 1. Add the tool definition to `tools.json`

**File:** `web/src-shared/tools.json`

Add an entry to the `tools` array:

```json
{
  "name": "your_tool_name",
  "type": "mutation",
  "description": "One-line description of what it does.",
  "parameters": {
    "param_name": {
      "type": "string",
      "description": "What this parameter controls.",
      "required": true
    }
  }
}
```

Naming rules:
- snake_case for tool name and parameters.
- `clip_id` should be optional on mutation tools (falls back to selected clip).
- If the tool uses an effect ID, reference the enum from `tools.json:118-139`.

### 2. Add the TS handler in `tool-registry.ts`

**File:** `web/src/lib/agent/tool-registry.ts`

Add an entry to the `TOOL_HANDLERS` object:

```typescript
your_tool_name: async (args: Record<string, unknown>): Promise<ToolResult> => {
  const state = useEditorStore.getState();
  // For mutations: wrap in undo batch
  state.beginUndoBatch();
  try {
    // Call the Zustand action
    state.yourAction(args.param_name as string);
    state.commitUndoBatch('your_tool_name', args);
    return { success: true, data: { /* result */ } };
  } catch (err) {
    state.commitUndoBatch('your_tool_name', args); // still commit to capture partial state
    throw err;
  }
},
```

**Exception:** If your Zustand action already calls `pushUndo()` internally (like `addClipFromMedia` does), skip the `beginUndoBatch`/`commitUndoBatch` wrapper to avoid duplicate undo entries. See `tool-registry.ts:11-13` for the rationale.

### 3. Add the Zustand action (if needed)

**File:** `web/src/lib/store/editor-store.ts`

Add the action to the appropriate slice. Follow the slice independence rules documented in `editor-store.ts:7-29`:
- Project mutations go in the project slice.
- Don't cross-modify other slices (especially playback) unless documented.

### 4. Add the Rust MCP handler

**File:** `web/src-tauri/src/mcp/mod.rs`

Add a parameter struct and a `#[tool]` method on `ChatCutServer`:

```rust
#[derive(Debug, Deserialize, JsonSchema)]
pub struct YourToolParams {
    /// Description of the param.
    pub param_name: String,
}

#[tool(name = "your_tool_name", description = "One-line description.")]
async fn your_tool_name(&self, #[tool(params)] params: YourToolParams) -> Result<CallToolResult, McpError> {
    // Implementation
}
```

For introspection tools: read from `project::reader`. For mutation tools: write via `project::write_project`.

### 5. Test manually

There is no automated test harness yet (see `roadmap/F006-test-harness.md`). Manual test:

1. `npm run tauri dev` — verify the tool works via chat.
2. `npx @modelcontextprotocol/inspector` — verify the tool appears and is callable via MCP.

### 6. Update the KB

- Bump `tools.json` version if adding a new tool category.
- Update `docs/kb/current-state.md` tool count.
- Update `docs/kb/architecture.md` module table if LOC changed significantly.

## Common mistakes

- **Forgetting the Rust handler:** The tool will work in the web UI but be invisible to external MCP clients.
- **Using `Date.now()` for IDs:** Collides on rapid calls. Use `uuid()`.
- **Not handling missing `clip_id`:** Most mutation tools should fall back to `ui.selectedClipIds[0]`.
- **Breaking slice independence:** A new project mutation must not modify `playback.*` unless explicitly documented.
