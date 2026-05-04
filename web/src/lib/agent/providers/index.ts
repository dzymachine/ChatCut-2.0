/**
 * Unified LLM Provider Interface
 *
 * Each provider adapter implements streamTurn to handle one conversational turn
 * with streaming and tool-use support.
 */

import type { ToolDef } from '../../../../src-shared/tools';
import { AnthropicProvider } from './anthropic';
import { GroqProvider } from './groq';
import { GeminiProvider } from './gemini';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentConfig {
  provider: 'anthropic' | 'groq' | 'gemini';
  apiKey: string;
  model?: string;
}

export interface StreamDelta {
  type: 'text' | 'tool_use_start' | 'tool_use_end' | 'tool_result' | 'error' | 'done';
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: { success: boolean; data?: unknown; error?: string };
}

/** Internal message format used within the agent loop. */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LLMProvider {
  streamTurn(
    messages: Message[],
    tools: ToolDef[],
    onDelta: (delta: StreamDelta) => void,
    signal?: AbortSignal
  ): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createProvider(config: AgentConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.apiKey, config.model);
    case 'groq':
      return new GroqProvider(config.apiKey, config.model);
    case 'gemini':
      return new GeminiProvider(config.apiKey, config.model);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
