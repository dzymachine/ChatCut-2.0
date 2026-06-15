"use client";

import { useState } from "react";
import { useSettingsStore, type AIProvider } from "@/lib/store/settings-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: "Anthropic",
  groq: "Groq",
  gemini: "Gemini",
};

export function ApiKeySetting() {
  const provider = useSettingsStore((s) => s.provider);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const runwayApiKey = useSettingsStore((s) => s.runwayApiKey);
  const setRunwayApiKey = useSettingsStore((s) => s.setRunwayApiKey);
  const [runwayDraft, setRunwayDraft] = useState(runwayApiKey);
  const [runwaySaved, setRunwaySaved] = useState(false);

  const [draft, setDraft] = useState(apiKeys[provider]);
  const [saved, setSaved] = useState(false);

  // When the active provider changes, resync the field to that provider's
  // stored key and clear the saved flag — otherwise the input keeps showing
  // the previously-selected provider's key. Uses the "adjust state during
  // render" pattern (React docs) instead of an effect, so there's no extra
  // committed frame with stale text. Keyed on `provider` only, so saving a
  // key doesn't clobber the "Saved" confirmation or interrupt typing.
  const [prevProvider, setPrevProvider] = useState(provider);
  if (provider !== prevProvider) {
    setPrevProvider(provider);
    setDraft(apiKeys[provider]);
    setSaved(false);
  }

  const handleSave = () => {
    setApiKey(provider, draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const currentKey = apiKeys[provider];

  return (
    <div className="space-y-2">
      <label className="text-xs text-neutral-400">
        {PROVIDER_LABELS[provider]} API Key
      </label>
      <div className="flex items-center gap-2" data-api-key-input>
        <Input
          type="password"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          placeholder={`Enter ${PROVIDER_LABELS[provider]} API key...`}
          className="flex-1 bg-neutral-800 border-neutral-700 text-neutral-200 placeholder:text-neutral-500 text-xs font-mono"
        />
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          className="bg-blue-600 hover:bg-blue-500 text-white text-xs"
        >
          {saved ? "Saved" : "Save"}
        </Button>
      </div>
      {currentKey && (
        <p className="text-[10px] text-neutral-500">
          Key configured ({currentKey.slice(0, 8)}...)
        </p>
      )}

      {/* Runway — service key for generative clips, separate from chat providers */}
      <label className="text-xs text-neutral-400 block pt-2">Runway API Key (generative clips)</label>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          value={runwayDraft}
          onChange={(e) => {
            setRunwayDraft(e.target.value);
            setRunwaySaved(false);
          }}
          placeholder="Enter Runway API key..."
          className="flex-1 bg-neutral-800 border-neutral-700 text-neutral-200 placeholder:text-neutral-500 text-xs font-mono"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setRunwayApiKey(runwayDraft);
            setRunwaySaved(true);
            setTimeout(() => setRunwaySaved(false), 2000);
          }}
          className="bg-blue-600 hover:bg-blue-500 text-white text-xs"
        >
          {runwaySaved ? "Saved" : "Save"}
        </Button>
      </div>
      {runwayApiKey && (
        <p className="text-[10px] text-neutral-500">
          Key configured ({runwayApiKey.slice(0, 8)}...)
        </p>
      )}
    </div>
  );
}
