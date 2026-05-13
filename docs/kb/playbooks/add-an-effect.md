# Playbook: Add a New Effect

> **Purpose:** Step-by-step recipe for adding a new visual/audio effect to ChatCut.
> **Last touched:** 2026-05-11
> **Status:** Active

## Prerequisites

- Identify the FFmpeg filter name (e.g. `hflip`, `colorbalance`). Use `ffmpeg -filters` to browse.
- Decide on a ChatCut effect ID (snake_case, e.g. `horizontal_flip`). This is **not** an Adobe matchName — the two namespaces never mix.

## Steps

### 1. Create the effect descriptor

**File:** `web/src/lib/effects/registry.ts`

Add an `EffectDescriptor` object and register it in `EFFECT_REGISTRY`:

```typescript
const HORIZONTAL_FLIP: EffectDescriptor = {
  id: 'horizontal_flip',
  name: 'Horizontal Flip',
  category: 'transform',    // transform | color | filter | transition | playback
  builtIn: true,
  ffmpegFilter: 'hflip',
  parameters: [],            // empty for parameterless effects
};

// In the EFFECT_REGISTRY map:
horizontal_flip: HORIZONTAL_FLIP,
```

For effects with parameters:
```typescript
parameters: [
  {
    id: 'amount',
    name: 'Amount',
    type: 'number',
    min: 0,
    max: 100,
    step: 1,
    default: 50,
    ffmpegParam: 'amount',    // maps to the FFmpeg filter param name
  },
],
```

### 2. Add FFmpeg mapping (if custom)

**File:** `web/src/lib/effects/ffmpeg-mapper.ts`

If the effect needs custom FFmpeg filter-graph logic (beyond simple `filtername=param1=val1:param2=val2`), add a case in the mapper. Most effects don't need this — the default mapping handles simple param-to-filter translation.

### 3. Add to `tools.json` effect_id enum

**File:** `web/src-shared/tools.json` (lines 118-139)

Add your effect ID to the `enum` array in the `apply_effect` tool's `effect_id` parameter:

```json
"enum": [
  "scale",
  "position",
  ...
  "horizontal_flip"
]
```

### 4. Add preview support (if applicable)

**File:** `web/src/lib/effects/transform-bridge.ts`

If the effect has a visible canvas-preview representation (transforms, opacity, etc.), add CSS transform or canvas operation mapping here. Not all effects need this — color effects may only be visible in the exported video.

### 5. Add the Rust export mapping

**File:** `web/src-tauri/src/export.rs` (lines 134-304, `build_effect_filters` fn — effect `match` at :142)

Add a match arm for your effect ID that generates the correct FFmpeg filter string. This is the god-file — be careful with the match ordering.

If using the recipe system instead, add the filter to the FFmpeg catalog:

**File:** `web/src-tauri/src/ffmpeg/catalog.rs`

### 6. Test

Manual verification:
1. In chat: "apply horizontal flip to the clip" → verify `apply_effect` tool is called with `effect_id: "horizontal_flip"`.
2. Export the video → verify the FFmpeg output includes the `hflip` filter.
3. Via MCP inspector: call `apply_effect` with the new effect ID → verify success.

## Checklist

- [ ] `EffectDescriptor` in `registry.ts`
- [ ] Registered in `EFFECT_REGISTRY`
- [ ] Added to `tools.json` `effect_id` enum
- [ ] FFmpeg export mapping in `export.rs` or `ffmpeg-mapper.ts`
- [ ] Canvas preview in `transform-bridge.ts` (if applicable)
- [ ] FFmpeg catalog entry (if using recipe system)
- [ ] Manual test: chat → apply → export → verify

## Common mistakes

- **ID mismatch between `registry.ts` and `tools.json`:** The `effect_id` enum must exactly match the `id` field in the descriptor. No automated check exists yet.
- **Forgetting the Rust export arm:** Effect applies in preview but is missing from exported video.
- **Wrong FFmpeg filter name:** Use `ffmpeg -h filter=<name>` to verify parameter names before coding.
