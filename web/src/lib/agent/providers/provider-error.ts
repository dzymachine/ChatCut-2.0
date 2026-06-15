/**
 * Shared error handling for LLM provider adapters.
 *
 * All three providers (Anthropic/Groq/Gemini) need identical terminal
 * handling in streamTurn: swallow aborts as a clean 'done', everything
 * else becomes a user-readable 'error' delta.
 */

import type { StreamDelta } from './index';

/** True for user-initiated cancellation (stop button / unmount). */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Format a provider/SDK error into a message a non-developer can act on.
 * SDK errors commonly carry an HTTP `status`; map the frequent ones.
 */
export function formatProviderError(error: unknown, providerName: string): string {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;

  switch (status) {
    case 401:
    case 403:
      return `${providerName} rejected the API key (HTTP ${status}). Check the key in Settings.`;
    case 429:
      return `${providerName} rate limit hit (HTTP 429). Wait a moment and try again.`;
    case 500:
    case 502:
    case 503:
    case 529:
      return `${providerName} is having service issues (HTTP ${status}). Try again shortly.`;
  }

  if (error instanceof Error) {
    // Browser fetch failures surface as TypeError("Failed to fetch") etc.
    if (error.name === 'TypeError' && /fetch/i.test(error.message)) {
      return `Could not reach ${providerName} — check your network connection.`;
    }
    return error.message;
  }
  return `${providerName} API error`;
}

/**
 * Terminal catch-block handler for streamTurn: emits 'done' on abort,
 * otherwise a formatted 'error' delta.
 */
export function handleStreamError(
  error: unknown,
  providerName: string,
  onDelta: (delta: StreamDelta) => void,
  signal?: AbortSignal,
): void {
  if (isAbortError(error, signal)) {
    onDelta({ type: 'done' });
    return;
  }
  onDelta({ type: 'error', content: formatProviderError(error, providerName) });
}
