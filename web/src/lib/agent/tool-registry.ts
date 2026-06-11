/**
 * ChatCut Agent — Tool Registry
 *
 * Maps each tool from tools.json to the corresponding Zustand store action.
 * Introspection tools return data; mutation tools modify state and produce
 * an EditNode in the edit history.
 *
 * Mutation tools are wrapped with beginUndoBatch/commitUndoBatch so that
 * the entire operation is captured as a single undo entry.
 *
 * NOTE: `addClipFromMedia` already pushes its own undo entry internally,
 * so we skip the batch wrapper for `add_clip` to avoid duplicate entries.
 */

import { v4 as uuid } from 'uuid';
import { TOOLS } from '../../../src-shared/tools';
import { useEditorStore } from '@/lib/store/editor-store';
import { getEffectDescriptor } from '@/lib/effects/registry';
import { isTauri } from '@/lib/tauri/bridge';
import { compileRecipe } from '@/lib/recipe/compiler';
import { validateRecipeStructure } from '@/lib/recipe/validator';
import { summarizeEditNode } from './summarize';
import type { Recipe } from '../../../src-shared/recipe';
import type { ToolCall, ToolResult } from './types';

// ─── Tool Execution ────────────────────────────────────────────────────────────

/**
 * Execute a tool call against the editor store WITHOUT recording edit history.
 * Use `executeToolWithHistory` for the standard path that records mutations
 * in the edit history panel.
 */
export async function executeToolRaw(call: ToolCall): Promise<ToolResult> {
  const toolDef = TOOLS.find((t) => t.name === call.name);
  if (!toolDef) {
    return { success: false, error: `Unknown tool: ${call.name}` };
  }

  const handler = TOOL_HANDLERS[call.name];
  if (!handler) {
    return { success: false, error: `No handler registered for tool: ${call.name}` };
  }

  try {
    return await handler(call.arguments);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Execute a mutation tool and record it in the edit history.
 * Returns both the ToolResult and the generated edit node id (if mutation succeeded).
 *
 * The snapshot is now captured inside `appendEditNode` (full project state),
 * so we no longer depend on undoStack growth to gate history recording.
 */
export async function executeToolWithHistory(call: ToolCall): Promise<ToolResult & { editNodeId?: string }> {
  const toolDef = TOOLS.find((t) => t.name === call.name);
  const isMutation = toolDef?.type === 'mutation';

  const result = await executeToolRaw(call);
  if (!result.success) return result;
  if (!isMutation) return result;

  const store = useEditorStore.getState();

  // Extract effect identifiers so EditNode can support per-effect toggle/delete
  let appliedEffectId: string | undefined;
  let targetClipId: string | undefined;

  if (call.name === 'apply_effect' && result.data) {
    const applied = result.data as { id?: string; clipId?: string };
    appliedEffectId = applied.id;
    targetClipId = (call.arguments.clip_id as string | undefined)
      ?? store.getActiveClip()?.id;
  } else if (call.name === 'update_effect_param' && result.data) {
    const data = result.data as { clipId?: string; appliedEffectId?: string };
    appliedEffectId = data.appliedEffectId;
    targetClipId = data.clipId;
  }

  const editNodeId = store.appendEditNode({
    toolName: call.name,
    args: call.arguments,
    ...(appliedEffectId && { appliedEffectId }),
    ...(targetClipId && { targetClipId }),
  });

  // Fire-and-forget Haiku summary (non-blocking)
  summarizeEditNode(editNodeId, call.name, call.arguments);

  return { ...result, editNodeId };
}

/**
 * Primary entry point — executes a tool and records mutations in edit history.
 * This is the function the ChatPanel / agent loop should call.
 */
export const executeTool = executeToolWithHistory;

// ─── Handler Map ───────────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`"${cmd}" requires the desktop app`);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // ── Introspection ──

  get_timeline_state: () => {
    const store = useEditorStore.getState();
    return {
      success: true,
      data: {
        tracks: store.project.tracks,
        composition: store.project.composition,
      },
    };
  },

  get_media_library: () => {
    const store = useEditorStore.getState();
    return {
      success: true,
      data: Array.from(store.assets.values()),
    };
  },

  get_clip_at_time: (args) => {
    const time = args.time as number;
    if (typeof time !== 'number') {
      return { success: false, error: 'Parameter "time" is required and must be a number.' };
    }
    const store = useEditorStore.getState();
    const clip = store.getClipAtTime(time);
    return { success: true, data: clip };
  },

  get_selected_clip: () => {
    const store = useEditorStore.getState();
    const clip = store.getActiveClip();
    return { success: true, data: clip };
  },

  // ── Mutations ──

  add_clip: (args) => {
    const store = useEditorStore.getState();
    const mediaFileId = args.media_file_id as string;
    if (!mediaFileId) {
      return { success: false, error: 'Parameter "media_file_id" is required.' };
    }

    const mediaFile = store.assets.get(mediaFileId);
    if (!mediaFile) {
      return { success: false, error: `Media file not found: ${mediaFileId}` };
    }

    const trackId = args.track_id as string | undefined;
    const timelineStart = args.timeline_start as number | undefined;

    // addClipFromMedia already pushes its own undo entry — no batch needed.
    const clip = store.addClipFromMedia(mediaFile, trackId, timelineStart);
    return { success: true, data: clip };
  },

  remove_clip: (args) => {
    const store = useEditorStore.getState();
    let clipId = args.clip_id as string | undefined;

    if (!clipId) {
      const activeClip = store.getActiveClip();
      if (!activeClip) {
        return { success: false, error: 'No clip_id provided and no clip is currently selected.' };
      }
      clipId = activeClip.id;
    }

    // Verify clip exists
    if (!store.getClipById(clipId)) {
      return { success: false, error: `Clip not found: ${clipId}` };
    }

    store.beginUndoBatch('Remove clip');
    store.removeClip(clipId);
    store.commitUndoBatch();
    return { success: true, data: { removedClipId: clipId } };
  },

  trim_clip: (args) => {
    const store = useEditorStore.getState();
    let clipId = args.clip_id as string | undefined;

    if (!clipId) {
      const activeClip = store.getActiveClip();
      if (!activeClip) {
        return { success: false, error: 'No clip_id provided and no clip is currently selected.' };
      }
      clipId = activeClip.id;
    }

    const clip = store.getClipById(clipId);
    if (!clip) {
      return { success: false, error: `Clip not found: ${clipId}` };
    }

    const sourceStart = args.source_start as number | undefined;
    const sourceEnd = args.source_end as number | undefined;

    if (sourceStart === undefined && sourceEnd === undefined) {
      return { success: false, error: 'At least one of "source_start" or "source_end" must be provided.' };
    }

    store.beginUndoBatch('Trim clip');

    if (sourceStart !== undefined) {
      // When trimming from the head, shift timelineStart by the same delta
      // so the clip stays anchored visually at its trimmed-in point.
      const delta = sourceStart - clip.sourceStart;
      const newTimelineStart = clip.timelineStart + delta;
      store.trimClipStart(clipId, sourceStart, newTimelineStart);
    }

    if (sourceEnd !== undefined) {
      store.trimClipEnd(clipId, sourceEnd);
    }

    store.commitUndoBatch();
    return { success: true, data: { clipId } };
  },

  move_clip: (args) => {
    const store = useEditorStore.getState();
    let clipId = args.clip_id as string | undefined;

    if (!clipId) {
      const activeClip = store.getActiveClip();
      if (!activeClip) {
        return { success: false, error: 'No clip_id provided and no clip is currently selected.' };
      }
      clipId = activeClip.id;
    }

    if (!store.getClipById(clipId)) {
      return { success: false, error: `Clip not found: ${clipId}` };
    }

    const timelineStart = args.timeline_start as number;
    if (typeof timelineStart !== 'number') {
      return { success: false, error: 'Parameter "timeline_start" is required and must be a number.' };
    }

    const trackId = args.track_id as string | undefined;

    store.beginUndoBatch('Move clip');
    store.moveClip(clipId, timelineStart, trackId);
    store.commitUndoBatch();
    return { success: true, data: { clipId, timelineStart, trackId } };
  },

  apply_effect: (args) => {
    const store = useEditorStore.getState();
    let clipId = args.clip_id as string | undefined;

    if (!clipId) {
      const activeClip = store.getActiveClip();
      if (!activeClip) {
        return { success: false, error: 'No clip_id provided and no clip is currently selected.' };
      }
      clipId = activeClip.id;
    }

    if (!store.getClipById(clipId)) {
      return { success: false, error: `Clip not found: ${clipId}` };
    }

    const effectId = args.effect_id as string;
    if (!effectId) {
      return { success: false, error: 'Parameter "effect_id" is required.' };
    }

    // Normalize parameters: LLMs often use generic keys like "value" or
    // "amount" instead of the effect's specific parameter IDs. Map them
    // to the first parameter of the effect descriptor when possible.
    let parameters = args.parameters as Record<string, number> | undefined;
    if (parameters) {
      const descriptor = getEffectDescriptor(effectId);
      if (descriptor && descriptor.parameters.length > 0) {
        const primaryParam = descriptor.parameters[0];
        const hasCorrectKey = primaryParam.id in parameters;
        if (!hasCorrectKey) {
          const fallback = parameters.value ?? parameters.amount ?? parameters.level;
          if (fallback !== undefined) {
            parameters = { ...parameters, [primaryParam.id]: Number(fallback) };
          }
        }
      }
    }

    store.beginUndoBatch('Apply effect');
    const appliedEffect = store.addEffect(clipId, effectId, parameters);
    store.commitUndoBatch();

    if (!appliedEffect) {
      return { success: false, error: 'Failed to apply effect.' };
    }

    return { success: true, data: appliedEffect };
  },

  update_effect_param: (args) => {
    const store = useEditorStore.getState();
    let clipId = args.clip_id as string | undefined;

    if (!clipId) {
      const activeClip = store.getActiveClip();
      if (!activeClip) {
        return { success: false, error: 'No clip_id provided and no clip is currently selected.' };
      }
      clipId = activeClip.id;
    }

    if (!store.getClipById(clipId)) {
      return { success: false, error: `Clip not found: ${clipId}` };
    }

    const appliedEffectId = args.applied_effect_id as string;
    if (!appliedEffectId) {
      return { success: false, error: 'Parameter "applied_effect_id" is required.' };
    }

    const parameters = args.parameters as Record<string, number>;
    if (!parameters || typeof parameters !== 'object') {
      return { success: false, error: 'Parameter "parameters" is required and must be an object.' };
    }

    store.beginUndoBatch('Update effect parameters');
    store.updateEffect(clipId, appliedEffectId, parameters);
    store.commitUndoBatch();
    return { success: true, data: { clipId, appliedEffectId, parameters } };
  },

  remove_effect: (args) => {
    const store = useEditorStore.getState();
    let clipId = args.clip_id as string | undefined;

    if (!clipId) {
      const activeClip = store.getActiveClip();
      if (!activeClip) {
        return { success: false, error: 'No clip_id provided and no clip is currently selected.' };
      }
      clipId = activeClip.id;
    }

    if (!store.getClipById(clipId)) {
      return { success: false, error: `Clip not found: ${clipId}` };
    }

    const appliedEffectId = args.applied_effect_id as string;
    if (!appliedEffectId) {
      return { success: false, error: 'Parameter "applied_effect_id" is required.' };
    }

    // Verify the effect exists on the clip before mutating, so we can return
    // a clear error rather than silently no-op.
    const effects = store.getClipEffects(clipId);
    if (!effects.find((e) => e.id === appliedEffectId)) {
      return { success: false, error: `Applied effect not found on clip: ${appliedEffectId}` };
    }

    store.beginUndoBatch('Remove effect');
    store.removeEffect(clipId, appliedEffectId);
    store.commitUndoBatch();
    return { success: true, data: { clipId, appliedEffectId } };
  },

  toggle_effect: (args) => {
    const store = useEditorStore.getState();
    let clipId = args.clip_id as string | undefined;

    if (!clipId) {
      const activeClip = store.getActiveClip();
      if (!activeClip) {
        return { success: false, error: 'No clip_id provided and no clip is currently selected.' };
      }
      clipId = activeClip.id;
    }

    if (!store.getClipById(clipId)) {
      return { success: false, error: `Clip not found: ${clipId}` };
    }

    const appliedEffectId = args.applied_effect_id as string;
    if (!appliedEffectId) {
      return { success: false, error: 'Parameter "applied_effect_id" is required.' };
    }

    const enabled = args.enabled;
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Parameter "enabled" is required and must be a boolean.' };
    }

    const effects = store.getClipEffects(clipId);
    if (!effects.find((e) => e.id === appliedEffectId)) {
      return { success: false, error: `Applied effect not found on clip: ${appliedEffectId}` };
    }

    store.beginUndoBatch(enabled ? 'Enable effect' : 'Disable effect');
    store.toggleEffect(clipId, appliedEffectId, enabled);
    store.commitUndoBatch();
    return { success: true, data: { clipId, appliedEffectId, enabled } };
  },

  // ── FFmpeg Filter Catalog ──

  list_filter_categories: async () => {
    const data = await tauriInvoke('list_filter_categories');
    return { success: true, data };
  },

  list_filters: async (args) => {
    const data = await tauriInvoke('list_filters', {
      category: args.category as string | undefined,
      query: args.query as string | undefined,
    });
    return { success: true, data };
  },

  describe_filter: async (args) => {
    const filterName = args.filter_name as string;
    if (!filterName) {
      return { success: false, error: 'Parameter "filter_name" is required.' };
    }
    const data = await tauriInvoke('describe_filter', { filterName });
    return { success: true, data };
  },

  // ── Recipe Tools ──

  compose_recipe: async (args) => {
    const store = useEditorStore.getState();
    let clipId = args.clip_id as string | undefined;

    if (!clipId) {
      const activeClip = store.getActiveClip();
      if (!activeClip) {
        return { success: false, error: 'No clip_id provided and no clip is currently selected.' };
      }
      clipId = activeClip.id;
    }

    if (!store.getClipById(clipId)) {
      return { success: false, error: `Clip not found: ${clipId}` };
    }

    const incomingRecipe = args.recipe as Recipe | undefined;
    if (!incomingRecipe || typeof incomingRecipe !== 'object') {
      return { success: false, error: 'Parameter "recipe" is required.' };
    }
    // LLMs typically omit the top-level `id`. Inject one so downstream
    // (Tauri deserialization, project save/load round-trip) stays valid.
    const recipe: Recipe = incomingRecipe.id
      ? incomingRecipe
      : { ...incomingRecipe, id: `recipe-${uuid()}` };

    // Structural validation (cycles, dangling refs, duplicate ids)
    const validation = validateRecipeStructure(recipe);
    if (!validation.valid) {
      return { success: false, error: `Recipe invalid: ${validation.errors.join(', ')}` };
    }

    // Compile to filter string
    let filterString: string;
    try {
      filterString = compileRecipe(recipe);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ToolRegistry] compose_recipe compile FAILED:', message, recipe);
      return { success: false, error: `Recipe compilation failed: ${message}` };
    }

    // FFmpeg dry-run: catches non-existent filters (e.g. `vibrance` is not in
    // stock FFmpeg) and bad params BEFORE attaching to the clip. Without this,
    // invalid recipes silently attach and the user only sees the failure at
    // export time. Returning the FFmpeg error here lets the LLM see what
    // happened and retry with valid filters.
    if (isTauri()) {
      try {
        const dryRun = await tauriInvoke<{ valid: boolean; error?: string }>(
          'validate_recipe',
          { recipe }
        );
        if (!dryRun.valid) {
          console.warn('[ToolRegistry] compose_recipe DRY-RUN FAILED:', dryRun.error, recipe);
          return {
            success: false,
            error: `FFmpeg rejected the recipe: ${dryRun.error ?? 'unknown error'}. The filter chain compiled but FFmpeg refused it — most often because a filter name doesn't exist in stock FFmpeg (e.g. \`vibrance\`, \`tonemap\` without lavfi support). Use list_filters / describe_filter to confirm filter names before composing, or substitute with stock filters: vibrance → eq+colorchannelmixer, tonemap → eq+curves, etc.`,
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[ToolRegistry] compose_recipe dry-run threw, attaching anyway:', message);
        // Fall through — don't block on transient Tauri-side failures
      }
    }

    console.log('[ToolRegistry] compose_recipe ATTACHED', {
      clipId,
      nodeCount: recipe.nodes.length,
      connectionCount: recipe.connections.length,
      filterString,
      recipe,
    });

    store.beginUndoBatch('Compose recipe');
    store.setClipRecipe(clipId, recipe);
    store.commitUndoBatch();

    return { success: true, data: { clipId, filterString } };
  },

  validate_recipe: async (args) => {
    const recipe = args.recipe as Recipe | undefined;
    if (!recipe || typeof recipe !== 'object') {
      return { success: false, error: 'Parameter "recipe" is required.' };
    }

    // Structural validation first (fast, in-browser)
    const validation = validateRecipeStructure(recipe);
    if (!validation.valid) {
      return { success: true, data: { valid: false, errors: validation.errors } };
    }

    // Compile to check syntax
    let filterString: string;
    try {
      filterString = compileRecipe(recipe);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: true, data: { valid: false, error: message } };
    }

    // FFmpeg dry-run via Tauri (if available)
    if (isTauri()) {
      const data = await tauriInvoke('validate_recipe', { recipe });
      return { success: true, data };
    }

    // Browser-only: return structural + compile validation
    return { success: true, data: { valid: true, filterString } };
  },
};
