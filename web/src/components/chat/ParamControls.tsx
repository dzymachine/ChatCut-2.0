"use client";

/**
 * Inline parameter controls extracted from tool calls — sliders for numeric
 * params, toggles for booleans, with a ✓ Apply that overwrites that part of
 * the state THROUGH the tool layer (update_effect_param / update_recipe_param),
 * so every human tweak is validated, undoable, and lands in the edit-history
 * DAG exactly like an agent edit.
 */

import { useMemo, useState } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { executeToolWithHistory } from "@/lib/agent/tool-registry";
import { showToast } from "@/components/ui/toast-notification";
import { getEffectDescriptor } from "@/lib/effects/registry";
import type { Recipe } from "../../../src-shared/recipe";

type ParamValue = number | boolean;

/** Sensible slider ranges for common FFmpeg/effect params; heuristic fallback. */
const KNOWN_RANGES: Record<string, [number, number]> = {
  contrast: [0, 3], saturation: [0, 3], brightness: [-1, 1], exposure: [-3, 3],
  gamma: [0.1, 3], gamma_r: [0.1, 3], gamma_g: [0.1, 3], gamma_b: [0.1, 3],
  sigma: [0, 20], steps: [1, 6], alls: [0, 50], all_strength: [0, 50],
  opacity: [0, 1], all_opacity: [0, 1], scale: [0.1, 5], degrees: [-360, 360],
  rs: [-1, 1], gs: [-1, 1], bs: [-1, 1], rm: [-1, 1], gm: [-1, 1], bm: [-1, 1],
  rh: [-12, 12], gh: [-12, 12], bh: [-12, 12], rv: [-12, 12], gv: [-12, 12], bv: [-12, 12],
  decay: [0, 1], la: [-2, 5], lx: [3, 23], ly: [3, 23], h: [-180, 180], s: [0, 3],
};

function rangeFor(name: string, value: number): [number, number] {
  const known = KNOWN_RANGES[name];
  if (known) return known;
  if (value >= 0 && value <= 1) return [0, 1];
  if (value >= 0 && value <= 3) return [0, 3];
  const span = Math.max(Math.abs(value) * 2, 1);
  return value < 0 ? [-span, span] : [0, span];
}

function SliderRow({
  name, value, onChange,
}: { name: string; value: ParamValue; onChange: (v: ParamValue) => void }) {
  if (typeof value === "boolean") {
    return (
      <label className="flex items-center justify-between gap-2 py-0.5">
        <span className="text-[11px] text-neutral-400 font-mono truncate">{name}</span>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-blue-500"
        />
      </label>
    );
  }
  const [min, max] = rangeFor(name, value);
  const step = (max - min) / 100;
  return (
    <label className="flex items-center gap-2 py-0.5 min-w-0">
      <span className="text-[11px] text-neutral-400 font-mono w-20 shrink-0 truncate">{name}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 accent-blue-500 h-1"
      />
      <span className="text-[11px] text-neutral-300 font-mono w-12 text-right shrink-0 tabular-nums">
        {Number(value).toFixed(2)}
      </span>
    </label>
  );
}

function ApplyButton({ dirty, busy, onApply }: { dirty: boolean; busy: boolean; onApply: () => void }) {
  if (!dirty) return null;
  return (
    <button
      type="button"
      onClick={onApply}
      disabled={busy}
      title="Apply these values"
      className="ml-auto shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-600/90 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
    >
      {busy ? (
        <span className="animate-pulse">…</span>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      Apply
    </button>
  );
}

/** Controls for apply_effect / update_effect_param cards. */
export function EffectParamControls({
  clipId, appliedEffectId, effectId, initial,
}: {
  clipId: string;
  appliedEffectId: string;
  effectId: string;
  initial: Record<string, number>;
}) {
  const [values, setValues] = useState<Record<string, ParamValue>>(initial);
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(
    () => Object.keys(values).some((k) => values[k] !== initial[k]),
    [values, initial],
  );

  // Clamp ranges from the effect registry when the descriptor knows better.
  const descriptor = getEffectDescriptor(effectId);

  const entries = Object.entries(values).filter(([, v]) => typeof v === "number" || typeof v === "boolean");
  if (entries.length === 0) return null;

  const apply = async () => {
    setBusy(true);
    const numeric: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      numeric[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
    }
    const result = await executeToolWithHistory({
      name: "update_effect_param",
      arguments: { clip_id: clipId, applied_effect_id: appliedEffectId, parameters: numeric },
    });
    setBusy(false);
    if (result.success) {
      showToast("success", `${descriptor?.name ?? effectId} updated`);
    } else {
      showToast("error", result.error ?? "Failed to update effect");
    }
  };

  return (
    <div className="mt-1.5 rounded-md bg-neutral-900/70 px-2.5 py-1.5">
      <div className="flex items-center pb-1">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">Tune</span>
        <ApplyButton dirty={dirty} busy={busy} onApply={apply} />
      </div>
      {entries.map(([name, v]) => (
        <SliderRow
          key={name}
          name={name}
          value={v}
          onChange={(nv) => setValues((prev) => ({ ...prev, [name]: nv }))}
        />
      ))}
    </div>
  );
}

/** Controls for compose/append/refine cards — one group per structured node. */
export function RecipeParamControls({ clipId }: { clipId: string }) {
  // Read the LIVE recipe (it may have changed since this card was created).
  const recipe = useEditorStore((s) => {
    for (const t of s.project.tracks) {
      const c = t.clips.find((cc) => cc.id === clipId);
      if (c) return c.recipe;
    }
    return undefined;
  }) as Recipe | undefined;

  const [drafts, setDrafts] = useState<Record<string, Record<string, ParamValue>>>({});
  const [busyNode, setBusyNode] = useState<string | null>(null);

  if (!recipe || recipe.nodes.length === 0) return null;

  const tunable = recipe.nodes.filter(
    (n) => n.filter && n.params && Object.values(n.params).some((v) => typeof v === "number" || typeof v === "boolean"),
  );
  if (tunable.length === 0) return null;

  const applyNode = async (nodeId: string) => {
    const draft = drafts[nodeId];
    if (!draft) return;
    setBusyNode(nodeId);
    const result = await executeToolWithHistory({
      name: "update_recipe_param",
      arguments: { clip_id: clipId, node_id: nodeId, params: draft },
    });
    setBusyNode(null);
    if (result.success) {
      showToast("success", "Recipe updated — preview will re-render");
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
    } else {
      showToast("error", result.error ?? "Failed to update recipe");
    }
  };

  return (
    <div className="mt-1.5 space-y-1.5">
      {tunable.map((node) => {
        const current = node.params ?? {};
        const draft = drafts[node.id] ?? {};
        const merged: Record<string, ParamValue> = {};
        for (const [k, v] of Object.entries(current)) {
          if (typeof v === "number" || typeof v === "boolean") {
            merged[k] = (draft[k] ?? v) as ParamValue;
          }
        }
        const dirty = Object.keys(draft).length > 0;
        return (
          <div key={node.id} className="rounded-md bg-neutral-900/70 px-2.5 py-1.5">
            <div className="flex items-center pb-1">
              <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                {node.filter} <span className="text-neutral-600">({node.id})</span>
              </span>
              <ApplyButton
                dirty={dirty}
                busy={busyNode === node.id}
                onApply={() => applyNode(node.id)}
              />
            </div>
            {Object.entries(merged).map(([name, v]) => (
              <SliderRow
                key={name}
                name={name}
                value={v}
                onChange={(nv) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [node.id]: { ...prev[node.id], [name]: nv },
                  }))
                }
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
