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
import { appendToRecipe, refineRecipe, withComposeRevision, type RecipeFragment } from '@/lib/recipe/merge';
import { appendLearnedTemplate, searchTemplates } from '@/lib/recipe/template-cache';
import creativeFiltersJson from '../../../src-shared/creative-filters.json';
import { summarizeEditNode } from './summarize';
import type { Recipe } from '../../../src-shared/recipe';
import type { ToolCall, ToolResult } from './types';

/**
 * Shared validation pipeline for every recipe mutation: structural check →
 * compile → FFmpeg dry-run (catches hallucinated filters like `vibrance`
 * before they attach). Returns the compiled filter string on success.
 */
async function validateCompileDryRun(
  recipe: Recipe,
): Promise<{ ok: true; filterString: string } | { ok: false; error: string }> {
  const validation = validateRecipeStructure(recipe);
  if (!validation.valid) {
    return { ok: false, error: `Recipe invalid: ${validation.errors.join(', ')}` };
  }

  let filterString: string;
  try {
    filterString = compileRecipe(recipe);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Recipe compilation failed: ${message}` };
  }

  if (isTauri()) {
    try {
      const dryRun = await tauriInvoke<{ valid: boolean; error?: string }>('validate_recipe', {
        recipe,
      });
      if (!dryRun.valid) {
        return {
          ok: false,
          error: `FFmpeg rejected the recipe: ${dryRun.error ?? 'unknown error'}. The chain compiled but FFmpeg refused it — most often a filter that doesn't exist in stock FFmpeg (e.g. \`vibrance\`). Use list_filters / describe_filter / list_creative_filters to confirm names, or substitute stock filters (vibrance → eq+colorchannelmixer).`,
        };
      }
    } catch (err) {
      // Transient Tauri-side failure — don't block on it.
      console.warn('[ToolRegistry] recipe dry-run threw, continuing:', err);
    }
  }

  return { ok: true, filterString };
}

/** Resolve the target clip for recipe tools: explicit clip_id or selection. */
function resolveRecipeClip(args: Record<string, unknown>):
  | { ok: true; clipId: string; recipe?: Recipe }
  | { ok: false; error: string } {
  const store = useEditorStore.getState();
  let clipId = args.clip_id as string | undefined;
  if (!clipId) {
    const activeClip = store.getActiveClip();
    if (!activeClip) {
      return { ok: false, error: 'No clip_id provided and no clip is currently selected.' };
    }
    clipId = activeClip.id;
  }
  const clip = store.getClipById(clipId);
  if (!clip) {
    return { ok: false, error: `Clip not found: ${clipId}` };
  }
  return { ok: true, clipId, recipe: clip.recipe };
}

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
    const target = resolveRecipeClip(args);
    if (!target.ok) return { success: false, error: target.error };

    // compose SEEDS a recipe. Growing or rewriting an existing one goes
    // through append_to_recipe / refine_recipe so the revision log stays
    // honest (append-only until the user asks to refine).
    if (target.recipe && target.recipe.nodes.length > 0) {
      return {
        success: false,
        error: `Clip ${target.clipId} already has a recipe (${target.recipe.nodes.length} nodes). Use append_to_recipe to ADD to it, or refine_recipe to rewrite it (only when the user explicitly asks to simplify/redo the look). Use get_recipe to inspect the current graph.`,
      };
    }

    const incomingRecipe = args.recipe as Recipe | undefined;
    if (!incomingRecipe || typeof incomingRecipe !== 'object') {
      return { success: false, error: 'Parameter "recipe" is required.' };
    }
    const prompt = args.prompt as string | undefined;
    // LLMs typically omit the top-level `id`. Inject one so downstream
    // (Tauri deserialization, project save/load round-trip) stays valid.
    const recipe = withComposeRevision(
      incomingRecipe.id ? incomingRecipe : { ...incomingRecipe, id: `recipe-${uuid()}` },
      prompt,
    );

    const result = await validateCompileDryRun(recipe);
    if (!result.ok) return { success: false, error: result.error };

    store.beginUndoBatch('Compose recipe');
    store.setClipRecipe(target.clipId, recipe);
    store.commitUndoBatch();

    // Learn the look (fire-and-forget) so it's searchable next session.
    if (prompt) {
      void appendLearnedTemplate({ name: prompt.slice(0, 60), prompt, recipe });
    }

    console.log('[ToolRegistry] compose_recipe SEEDED', {
      clipId: target.clipId,
      nodeCount: recipe.nodes.length,
      filterString: result.filterString,
    });
    return { success: true, data: { clipId: target.clipId, filterString: result.filterString } };
  },

  append_to_recipe: async (args) => {
    const store = useEditorStore.getState();
    const target = resolveRecipeClip(args);
    if (!target.ok) return { success: false, error: target.error };

    const fragment = args.fragment as RecipeFragment | undefined;
    if (!fragment || !Array.isArray(fragment.nodes)) {
      return {
        success: false,
        error: 'Parameter "fragment" is required: { nodes: RecipeNode[], connections?: RecipeConnection[] }. Within a fragment, "input" = the END of the existing recipe and "output" = the clip output.',
      };
    }
    const prompt = args.prompt as string | undefined;

    const current: Recipe = target.recipe ?? {
      id: `recipe-${uuid()}`,
      nodes: [],
      connections: [],
    };

    const merge = appendToRecipe(current, fragment, prompt);
    if (!merge.ok) return { success: false, error: merge.error };

    // Validate the MERGED graph — an append that breaks the whole chain is
    // rejected atomically (the existing recipe stays untouched).
    const result = await validateCompileDryRun(merge.recipe);
    if (!result.ok) return { success: false, error: result.error };

    store.beginUndoBatch('Append to recipe');
    store.setClipRecipe(target.clipId, merge.recipe);
    store.commitUndoBatch();

    if (prompt) {
      void appendLearnedTemplate({ name: prompt.slice(0, 60), prompt, recipe: merge.recipe });
    }

    console.log('[ToolRegistry] append_to_recipe', {
      clipId: target.clipId,
      added: merge.revision.addedNodeIds,
      totalNodes: merge.recipe.nodes.length,
      revisions: merge.recipe.revisions?.length,
    });
    return {
      success: true,
      data: {
        clipId: target.clipId,
        addedNodeIds: merge.revision.addedNodeIds,
        totalNodes: merge.recipe.nodes.length,
        filterString: result.filterString,
      },
    };
  },

  refine_recipe: async (args) => {
    const store = useEditorStore.getState();
    const target = resolveRecipeClip(args);
    if (!target.ok) return { success: false, error: target.error };

    const incomingRecipe = args.recipe as Recipe | undefined;
    if (!incomingRecipe || typeof incomingRecipe !== 'object') {
      return { success: false, error: 'Parameter "recipe" (the full replacement graph) is required.' };
    }
    const prompt = args.prompt as string | undefined;

    const { recipe, revision } = refineRecipe(target.recipe, incomingRecipe, prompt);

    const result = await validateCompileDryRun(recipe);
    if (!result.ok) return { success: false, error: result.error };

    store.beginUndoBatch('Refine recipe');
    store.setClipRecipe(target.clipId, recipe);
    store.commitUndoBatch();

    console.log('[ToolRegistry] refine_recipe', {
      clipId: target.clipId,
      nodeCount: recipe.nodes.length,
      revisionId: revision.id,
    });
    return { success: true, data: { clipId: target.clipId, filterString: result.filterString } };
  },

  get_recipe: (args) => {
    const target = resolveRecipeClip(args);
    if (!target.ok) return { success: false, error: target.error };

    if (!target.recipe || target.recipe.nodes.length === 0) {
      return { success: true, data: { clipId: target.clipId, hasRecipe: false } };
    }

    let filterString = '';
    try {
      filterString = compileRecipe(target.recipe);
    } catch {
      // Compile failure on a stored recipe shouldn't block introspection.
    }
    return {
      success: true,
      data: {
        clipId: target.clipId,
        hasRecipe: true,
        recipe: target.recipe,
        filterString,
        revisions: target.recipe.revisions ?? [],
      },
    };
  },

  search_recipe_templates: async (args) => {
    const query = args.query as string | undefined;
    if (!query) {
      return { success: false, error: 'Parameter "query" is required (e.g. "vhs", "teal orange film look").' };
    }
    const matches = await searchTemplates(query);
    return {
      success: true,
      data: {
        matches: matches.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          learned: t.learned ?? false,
          recipe: t.recipe,
        })),
        hint: matches.length === 0
          ? 'No template matched — compose a recipe from scratch (list_creative_filters has grounded building blocks).'
          : 'Apply a match verbatim via compose_recipe (recipe-less clip) or adapt its nodes; tweak params to taste.',
      },
    };
  },

  list_creative_filters: () => {
    return {
      success: true,
      data: (creativeFiltersJson as { filters: unknown[] }).filters,
    };
  },

  list_luts: async () => {
    if (!isTauri()) {
      return { success: false, error: 'LUTs require the desktop app (FFmpeg needs filesystem paths).' };
    }
    const luts = await tauriInvoke<Array<{ name: string; path: string }>>('list_luts');
    return {
      success: true,
      data: {
        luts,
        hint: "Apply via a raw node: raw: \"lut3d='<path>'\". Partial strength: raw: \"split[__a][__b];[__b]lut3d='<path>'[__g];[__a][__g]blend=all_expr='A*(1-I)+B*I'\" with I = intensity 0..1.",
      },
    };
  },

  validate_recipe: async (args) => {
    const recipe = args.recipe as Recipe | undefined;
    if (!recipe || typeof recipe !== 'object') {
      return { success: false, error: 'Parameter "recipe" is required.' };
    }

    // An INVALID recipe is a FAILED tool call (success: false) — wrapping it
    // as success:true/data.valid:false made the tool card show green and let
    // the model read "success" while the logs showed the FFmpeg rejection.
    const result = await validateCompileDryRun(recipe);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    return { success: true, data: { valid: true, filterString: result.filterString } };
  },
};
