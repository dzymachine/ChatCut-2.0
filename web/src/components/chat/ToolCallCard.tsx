"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { EffectParamControls, RecipeParamControls } from "./ParamControls";

interface ToolCallCardProps {
  toolName: string;
  args?: Record<string, unknown>;
  result?: { success: boolean; data?: unknown; error?: string };
}

/** Friendly labels — the raw tool name stays visible in the expanded view. */
const TOOL_LABELS: Record<string, string> = {
  get_timeline_state: "Read timeline",
  get_media_library: "Read library",
  get_clip_at_time: "Find clip",
  get_selected_clip: "Read selection",
  get_recipe: "Inspect look",
  add_clip: "Add clip",
  remove_clip: "Remove clip",
  trim_clip: "Trim clip",
  move_clip: "Move clip",
  apply_effect: "Apply effect",
  update_effect_param: "Tune effect",
  remove_effect: "Remove effect",
  toggle_effect: "Toggle effect",
  compose_recipe: "Compose look",
  append_to_recipe: "Extend look",
  refine_recipe: "Rewrite look",
  update_recipe_param: "Tune look",
  validate_recipe: "Validate look",
  search_recipe_templates: "Search looks",
  list_creative_filters: "Browse filters",
  list_filter_categories: "Browse filters",
  list_filters: "Browse filters",
  describe_filter: "Inspect filter",
  list_luts: "Browse LUTs",
  generate_video_clip: "Generate clip",
};

/** One-line human summary from the args, per tool. */
function summarize(toolName: string, args?: Record<string, unknown>): string {
  if (!args) return "";
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (toolName) {
    case "apply_effect":
    case "remove_effect":
      return str("effect_id");
    case "compose_recipe":
    case "append_to_recipe":
    case "refine_recipe": {
      const container = (args.recipe ?? args.fragment) as { nodes?: unknown[] } | undefined;
      const n = container?.nodes?.length ?? 0;
      const p = str("prompt");
      return p ? `${p.slice(0, 48)}${p.length > 48 ? "…" : ""}` : n ? `${n} node${n > 1 ? "s" : ""}` : "";
    }
    case "update_recipe_param":
      return str("node_id");
    case "generate_video_clip": {
      const p = str("prompt");
      return p.slice(0, 48) + (p.length > 48 ? "…" : "");
    }
    case "search_recipe_templates":
      return str("query");
    case "describe_filter":
      return str("filter_name") || str("name");
    case "trim_clip":
    case "move_clip":
    case "remove_clip":
      return str("clip_id").slice(0, 8);
    default:
      return "";
  }
}

const RECIPE_TOOLS = new Set(["compose_recipe", "append_to_recipe", "refine_recipe", "update_recipe_param"]);

export function ToolCallCard({ toolName, args, result }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Pre-toggle top of the card, used to keep it visually anchored.
  const anchorTopRef = useRef<number | null>(null);

  // WebKit has no `overflow-anchor`: when the body expands/collapses, content
  // shifts and the reading position jumps. Compensate by keeping THIS card's
  // viewport-relative top constant across the toggle.
  const toggle = () => {
    anchorTopRef.current = rootRef.current?.getBoundingClientRect().top ?? null;
    setIsExpanded((v) => !v);
  };

  useLayoutEffect(() => {
    const prevTop = anchorTopRef.current;
    anchorTopRef.current = null;
    if (prevTop === null || !rootRef.current) return;
    const viewport = rootRef.current.closest('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    const newTop = rootRef.current.getBoundingClientRect().top;
    const delta = newTop - prevTop;
    if (Math.abs(delta) > 1) {
      viewport.scrollTop += delta;
    }
  }, [isExpanded]);

  const label = TOOL_LABELS[toolName] ?? toolName;
  const summary = summarize(toolName, args);
  const pending = !result;

  // Live param controls: effects need the applied-effect id from the result;
  // recipe tools read the live recipe by clip id.
  const clipId =
    (typeof args?.clip_id === "string" && args.clip_id) ||
    (result?.data && typeof result.data === "object" && "clipId" in result.data
      ? String((result.data as { clipId?: unknown }).clipId ?? "")
      : "");
  const effectData =
    toolName === "apply_effect" && result?.success && result.data && typeof result.data === "object"
      ? (result.data as { id?: string; effectId?: string; parameters?: Record<string, number> })
      : null;

  return (
    <div
      ref={rootRef}
      className="chat-message-in my-1.5 min-w-0 rounded-lg border border-neutral-800 bg-neutral-900/80 shadow-[0_2px_10px_rgba(0,0,0,0.28)] overflow-hidden"
    >
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full min-w-0 px-3 py-1.5 text-left hover:bg-neutral-800/70 transition-colors"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`shrink-0 text-neutral-500 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-xs font-medium text-neutral-200 shrink-0">{label}</span>
        {summary && (
          <span className="text-[11px] text-neutral-500 truncate min-w-0">{summary}</span>
        )}
        {pending ? (
          <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300/90 animate-pulse">
            running
          </span>
        ) : (
          <span
            className={`ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${
              result.success
                ? "bg-emerald-400/10 text-emerald-300/90"
                : "bg-red-400/10 text-red-300/90"
            }`}
          >
            {result.success ? "done" : "failed"}
          </span>
        )}
      </button>

      {/* Animated reveal: 0fr→1fr grid keeps height transitions smooth without
          measuring; the inner div min-h-0 makes the fraction collapse cleanly. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-3 py-2 border-t border-neutral-800 space-y-2 min-w-0">
            <div className="text-[10px] font-mono text-neutral-600">{toolName}</div>
            {args && Object.keys(args).length > 0 && (
              <div className="min-w-0">
                <span className="text-[10px] uppercase text-neutral-500 font-medium">Arguments</span>
                <pre className="mt-1 text-xs text-neutral-300 font-mono bg-neutral-950/60 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(args, null, 2)}
                </pre>
              </div>
            )}
            {result && (
              <div className="min-w-0">
                <span className="text-[10px] uppercase text-neutral-500 font-medium">Result</span>
                <pre
                  className={`mt-1 text-xs font-mono rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words ${
                    result.success ? "text-emerald-200/90 bg-emerald-950/25" : "text-red-200/90 bg-red-950/25"
                  }`}
                >
                  {result.error ? result.error : JSON.stringify(result.data, null, 2)}
                </pre>
              </div>
            )}

            {/* Inline tuning — human-in-the-loop overrides routed through the
                tool layer (validated, undoable, DAG-recorded). */}
            {effectData?.id && effectData.effectId && clipId && (
              <EffectParamControls
                clipId={clipId}
                appliedEffectId={effectData.id}
                effectId={effectData.effectId}
                initial={effectData.parameters ?? {}}
              />
            )}
            {RECIPE_TOOLS.has(toolName) && result?.success && clipId && (
              <RecipeParamControls clipId={clipId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
