/**
 * Anthropic Provider Adapter
 *
 * Uses the browser SDK (@anthropic-ai/sdk) with dangerouslyAllowBrowser.
 * Implements streaming with tool-use and prompt caching.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ToolDef } from '../../../../src-shared/tools';
import type { LLMProvider, Message, StreamDelta } from './index';
import { handleStreamError } from './provider-error';
import { SYSTEM_PROMPT } from './system-prompt';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Convert our internal tool format to Anthropic's tool schema. */
function convertTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((tool, index) => {
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

    const toolDef: Anthropic.Tool = {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties,
        required: required.length > 0 ? required : undefined,
      },
      // Cache breakpoint on the LAST tool covers system + all tools.
      ...(index === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    };

    return toolDef;
  });
}

/** Convert our internal message format to Anthropic's message format. */
function convertMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((msg) => {
      if (typeof msg.content === 'string') {
        return { role: msg.role as 'user' | 'assistant', content: msg.content };
      }

      // Convert block-based content
      const blocks = msg.content.map((block): Anthropic.ContentBlockParam => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          };
        }
        return { type: 'text', text: '' };
      });

      return { role: msg.role as 'user' | 'assistant', content: blocks };
    });
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({
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
    const anthropicTools = convertTools(tools);
    const anthropicMessages = convertMessages(messages);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    // Handle abort
    if (signal) {
      signal.addEventListener('abort', () => {
        stream.abort();
      }, { once: true });
    }

    try {
      // Accumulate tool_use blocks during streaming
      let currentToolName = '';
      let currentToolInput = '';

      for await (const event of stream) {
        if (signal?.aborted) break;

        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolName = block.name;
            currentToolInput = '';
            onDelta({
              type: 'tool_use_start',
              toolName: block.name,
            });
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            onDelta({ type: 'text', content: delta.text });
          } else if (delta.type === 'input_json_delta') {
            currentToolInput += delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          // If we were accumulating a tool_use block, emit it now
          if (currentToolName) {
            // Tools with no parameters stream no input → empty args is valid.
            // But if input WAS streamed and fails to parse, the model emitted
            // malformed JSON: surface the error and SKIP dispatch rather than
            // silently running the tool with {} (which yields confusing edits).
            let parsedArgs: Record<string, unknown> | null = {};
            if (currentToolInput) {
              try {
                parsedArgs = JSON.parse(currentToolInput);
              } catch (err) {
                parsedArgs = null;
                console.error(
                  `[anthropic] Malformed tool arguments for "${currentToolName}" — skipping. Raw input:`,
                  currentToolInput,
                  err
                );
                onDelta({
                  type: 'error',
                  content: `The model produced invalid arguments for "${currentToolName}", so it was skipped. Try rephrasing your request.`,
                });
              }
            }

            if (parsedArgs !== null) {
              onDelta({
                type: 'tool_use_start',
                toolName: currentToolName,
                toolArgs: parsedArgs,
              });
              onDelta({ type: 'tool_use_end', toolName: currentToolName });
            }
            currentToolName = '';
            currentToolInput = '';
          }
        }
      }

      onDelta({ type: 'done' });
    } catch (error: unknown) {
      handleStreamError(error, 'Anthropic', onDelta, signal);
    }
  }
}
