/**
 * Groq Provider Adapter
 *
 * Uses the Groq SDK (OpenAI-compatible) for streaming tool-use.
 * Model: llama-3.3-70b-versatile (default)
 */

import Groq from 'groq-sdk';
import type { ToolDef } from '../../../../src-shared/tools';
import type { LLMProvider, Message, StreamDelta } from './index';
import { handleStreamError } from './provider-error';
import { SYSTEM_PROMPT } from './system-prompt';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/** Convert our internal tool format to OpenAI function-calling format. */
function convertTools(tools: ToolDef[]): Groq.Chat.ChatCompletionTool[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, param] of Object.entries(tool.parameters)) {
      const prop: Record<string, unknown> = {
        type: param.type,
        description: param.description,
      };
      if (param.enum) {
        prop.enum = param.enum;
      }
      properties[key] = prop;
      if (param.required) {
        required.push(key);
      }
    }

    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
    };
  });
}

/** Convert internal messages to Groq/OpenAI chat format. */
function convertMessages(messages: Message[]): Groq.Chat.ChatCompletionMessageParam[] {
  const result: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      continue;
    }

    // Handle block-based content — ContentBlock is a discriminated union, so
    // filter() narrows each branch without casts.
    if (msg.role === 'assistant') {
      const textParts = msg.content.filter((b) => b.type === 'text').map((b) => b.text);
      const toolCalls = msg.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));

      result.push({
        role: 'assistant',
        content: textParts.join('') || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } else if (msg.role === 'user') {
      const toolResults = msg.content.filter((b) => b.type === 'tool_result');
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          });
        }
      } else {
        const textParts = msg.content.filter((b) => b.type === 'text').map((b) => b.text);
        result.push({ role: 'user', content: textParts.join('') });
      }
    }
  }

  return result;
}

export class GroqProvider implements LLMProvider {
  private client: Groq;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true,
    });
    this.model = model || DEFAULT_MODEL;
  }

  async streamTurn(
    messages: Message[],
    tools: ToolDef[],
    onDelta: (delta: StreamDelta) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const groqTools = convertTools(tools);
    const groqMessages = convertMessages(messages);

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: groqMessages,
        tools: groqTools,
        stream: true,
      });

      // Track tool calls being assembled from streaming deltas
      const toolCallAccumulators: Map<number, { id: string; name: string; args: string }> = new Map();

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta?.content) {
          onDelta({ type: 'text', content: delta.content });
        }

        // Tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, {
                id: tc.id || '',
                name: tc.function?.name || '',
                args: '',
              });
              if (tc.function?.name) {
                onDelta({ type: 'tool_use_start', toolName: tc.function.name });
              }
            }
            const acc = toolCallAccumulators.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }
        }

        // Finish reason
        if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
          // Emit completed tool calls
          for (const [, acc] of toolCallAccumulators) {
            try {
              const args = acc.args ? JSON.parse(acc.args) : {};
              onDelta({
                type: 'tool_use_start',
                toolName: acc.name,
                toolArgs: args,
              });
              onDelta({ type: 'tool_use_end', toolName: acc.name });
            } catch {
              onDelta({
                type: 'error',
                content: `Failed to parse tool call arguments for ${acc.name}`,
              });
            }
          }
        }
      }

      onDelta({ type: 'done' });
    } catch (error: unknown) {
      handleStreamError(error, 'Groq', onDelta, signal);
    }
  }
}
