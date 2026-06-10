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
    </div>
  );
}
