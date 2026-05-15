"use client";

import { useSettingsStore, type AIProvider } from "@/lib/store/settings-store";

const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: "Anthropic",
  groq: "Groq",
  gemini: "Gemini",
};

export function ProviderPicker() {
  const provider = useSettingsStore((s) => s.provider);
  const setProvider = useSettingsStore((s) => s.setProvider);

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-neutral-400">Provider</label>
      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value as AIProvider)}
        className="h-7 rounded-md border border-neutral-700 bg-neutral-800 px-2 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map((p) => (
          <option key={p} value={p}>
            {PROVIDER_LABELS[p]}
          </option>
        ))}
      </select>
    </div>
  );
}
