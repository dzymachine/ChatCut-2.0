"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { getUserEffects } from "@/lib/effects/registry";
import type { EffectDescriptor } from "@/types/effects";

interface EffectBrowserProps {
  clipId: string;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  color: "Color Correction",
  blur: "Blur & Sharpen",
  style: "Stylize",
  transition: "Transitions",
  speed: "Speed",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

export function EffectBrowser({ clipId, onClose }: EffectBrowserProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const addEffect = useEditorStore((s) => s.addEffect);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const grouped = useMemo(() => {
    const all = getUserEffects();
    const lowerQuery = query.toLowerCase();
    const filtered = lowerQuery
      ? all.filter((e) => e.name.toLowerCase().includes(lowerQuery))
      : all;

    const groups: { label: string; effects: EffectDescriptor[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const effects = filtered.filter((e) => e.category === cat);
      if (effects.length > 0) {
        groups.push({ label: CATEGORY_LABELS[cat], effects });
      }
    }
    return groups;
  }, [query]);

  const handleAdd = (effectId: string) => {
    addEffect(clipId, effectId);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  const isEmpty = grouped.length === 0;

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search effects..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full bg-neutral-800 border-0 border-b border-neutral-700 rounded-t-lg px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 outline-none"
      />

      <div className="max-h-[280px] overflow-y-auto">
        {isEmpty ? (
          <p className="px-3 py-4 text-xs text-neutral-500 text-center">
            No effects match your search
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.label}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 px-3 pt-2 pb-1">
                {group.label}
              </div>
              {group.effects.map((effect) => (
                <div
                  key={effect.id}
                  onClick={() => handleAdd(effect.id)}
                  className="px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800/60 cursor-pointer rounded-sm mx-1"
                >
                  {effect.name}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
