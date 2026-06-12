/**
 * ChatCut Settings Store
 *
 * Manages AI provider configuration (provider, model, API keys).
 * Keys are stored in localStorage for this sprint. Keyring integration is deferred.
 */

import { create } from 'zustand';

export type AIProvider = 'anthropic' | 'groq' | 'gemini';

export interface SettingsState {
  provider: AIProvider;
  model: string;
  apiKeys: Record<AIProvider, string>;
  /** Service key for Runway generation (separate from chat providers). */
  runwayApiKey: string;

  setProvider: (provider: AIProvider) => void;
  setModel: (model: string) => void;
  setApiKey: (provider: AIProvider, key: string) => void;
  setRunwayApiKey: (key: string) => void;
  getActiveApiKey: () => string;
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-pro',
};

function loadKeysFromStorage(): Record<AIProvider, string> {
  if (typeof window === 'undefined') {
    return { anthropic: '', groq: '', gemini: '' };
  }
  try {
    const stored = localStorage.getItem('chatcut_api_keys');
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        anthropic: parsed.anthropic || '',
        groq: parsed.groq || '',
        gemini: parsed.gemini || '',
      };
    }
  } catch {
    // ignore parse errors
  }
  return { anthropic: '', groq: '', gemini: '' };
}

function loadProviderFromStorage(): AIProvider {
  if (typeof window === 'undefined') return 'anthropic';
  try {
    const stored = localStorage.getItem('chatcut_provider');
    if (stored && (stored === 'anthropic' || stored === 'groq' || stored === 'gemini')) {
      return stored;
    }
  } catch {
    // ignore
  }
  return 'anthropic';
}

function saveKeysToStorage(keys: Record<AIProvider, string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('chatcut_api_keys', JSON.stringify(keys));
  } catch {
    // ignore quota errors
  }
}

function saveProviderToStorage(provider: AIProvider) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('chatcut_provider', provider);
  } catch {
    // ignore
  }
}

function loadRunwayKeyFromStorage(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem('chatcut_runway_key') ?? '';
  } catch {
    return '';
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initialProvider = loadProviderFromStorage();
  return {
    provider: initialProvider,
    model: DEFAULT_MODELS[initialProvider],
    apiKeys: loadKeysFromStorage(),
    runwayApiKey: loadRunwayKeyFromStorage(),

    setProvider: (provider) => {
      saveProviderToStorage(provider);
      set({ provider, model: DEFAULT_MODELS[provider] });
    },

    setModel: (model) => {
      set({ model });
    },

    setApiKey: (provider, key) => {
      const newKeys = { ...get().apiKeys, [provider]: key };
      saveKeysToStorage(newKeys);
      set({ apiKeys: newKeys });
    },

    setRunwayApiKey: (key) => {
      try {
        localStorage.setItem('chatcut_runway_key', key);
      } catch {
        // ignore quota errors
      }
      set({ runwayApiKey: key });
    },

    getActiveApiKey: () => {
      const state = get();
      return state.apiKeys[state.provider];
    },
  };
});
