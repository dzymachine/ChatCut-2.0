/**
 * ChatCut — AI Backend Client
 *
 * Communicates with the existing FastAPI backend for:
 *  1. Processing natural language editing commands → structured actions
 *  2. Answering questions about video editing
 *
 * The backend URL is proxied through Next.js rewrites so we never expose
 * the backend directly to the client.
 */

import { isTauri } from '@/lib/tauri/bridge';

/**
 * In browser/dev mode, Next.js rewrites proxy /api/ai/* to localhost:3001.
 * In Tauri production (static export), there are no rewrites — call the
 * backend directly. The backend URL can be overridden via environment.
 */
function getApiBase(): string {
  if (isTauri()) {
    // Static export — no Next.js server to proxy through.
    // Talk directly to the FastAPI backend.
    return 'http://localhost:3001/api';
  }
  // Browser/dev mode — use Next.js proxy rewrites
  return '/api/ai';
}

function getHealthUrl(): string {
  if (isTauri()) {
    return 'http://localhost:3001/health';
  }
  return '/api/ai/health';
}

// All functions use getApiBase() / getHealthUrl() which detect Tauri at runtime

export interface AIResponse {
  response: string;
  actions?: RawAIAction[];
  error?: string;
}

/** The raw action format returned by the FastAPI backend. */
export interface RawAIAction {
  action: string;
  parameters: Record<string, unknown>;
}

/**
 * Send a natural language editing command to the AI backend.
 */
export async function processPrompt(
  prompt: string,
  context?: PromptContext
): Promise<AIResponse> {
  try {
    const response = await fetch(`${getApiBase()}/process-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        context: context || {},
        client_type: 'desktop',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { response: '', error: `Backend error: ${response.status} — ${error}` };
    }

    const data = await response.json();

    // Normalize actions: the backend may return a single action in
    // `data.action` + `data.parameters` or an array in `data.actions`.
    // The frontend always works with an actions array.
    let actions: RawAIAction[] = [];
    if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
      actions = data.actions;
    } else if (data.action && typeof data.action === 'string') {
      actions = [{ action: data.action, parameters: data.parameters || {} }];
    }

    return {
      response: data.response || data.message || '',
      actions,
    };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        response: '',
        error: 'Cannot connect to backend. Make sure the ChatCut backend is running on port 3001.',
      };
    }
    return {
      response: '',
      error: `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Ask a question about video editing (uses the question service).
 */
export async function askQuestion(question: string): Promise<{ answer: string; error?: string }> {
  try {
    const response = await fetch(`${getApiBase()}/ask-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: question }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { answer: '', error: `Backend error: ${response.status} — ${error}` };
    }

    const data = await response.json();
    return { answer: data.answer || data.response || '' };
  } catch (error) {
    return {
      answer: '',
      error: `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Check if the backend is reachable.
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(getHealthUrl(), {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Context sent with each prompt to help the AI make better decisions. */
interface PromptContext {
  /** Current transform values for the active clip. */
  currentTransform?: Record<string, unknown>;
  /** Whether a clip is loaded. */
  hasClip?: boolean;
  /** Duration of the current clip. */
  clipDuration?: number;
}
