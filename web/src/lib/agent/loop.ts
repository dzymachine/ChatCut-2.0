/**
 * ChatCut Agent Loop
 *
 * Provider-agnostic tool-use loop with a max of 8 iterations.
 * On each iteration: calls the active provider's streamTurn, collects response.
 * If the response contains tool_use blocks: executes each tool, appends results, loops.
 * If text-only: done — returns the final text.
 */

import { TOOLS } from '../../../src-shared/tools';
import {
  createProvider,
  type AgentConfig,
  type StreamDelta,
  type Message,
  type ContentBlock,
} from './providers/index';
import { executeTool } from './tool-registry';

const MAX_ITERATIONS = 8;

export type { AgentConfig, StreamDelta };

/**
 * Run the agent loop.
 *
 * @param userMessages - Array of simple messages from the chat history
 * @param config - Provider configuration (provider, apiKey, model)
 * @param onDelta - Callback for streaming deltas to the UI
 * @param signal - Optional AbortSignal for cancellation
 * @returns The final assistant text response
 */
export async function runAgentLoop(
  userMessages: Array<{ role: string; content: string }>,
  config: AgentConfig,
  onDelta: (delta: StreamDelta) => void,
  signal?: AbortSignal
): Promise<string> {
  const provider = createProvider(config);

  // Convert simple messages to our internal format
  const messages: Message[] = userMessages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  let finalText = '';
  let iterations = 0;
  let lastIterationHadToolCalls = false;

  while (iterations < MAX_ITERATIONS) {
    if (signal?.aborted) break;
    iterations++;

    // Collect the response from this turn
    let turnText = '';
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    let hasError = false;

    await provider.streamTurn(
      messages,
      TOOLS,
      (delta) => {
        switch (delta.type) {
          case 'text':
            turnText += delta.content || '';
            onDelta(delta);
            break;

          case 'tool_use_start':
            if (delta.toolArgs) {
              // Complete tool call with args
              const toolId = `tool_${Date.now()}_${toolCalls.length}`;
              toolCalls.push({
                id: toolId,
                name: delta.toolName || '',
                args: delta.toolArgs,
              });
            }
            onDelta(delta);
            break;

          case 'tool_use_end':
            onDelta(delta);
            break;

          case 'error':
            hasError = true;
            onDelta(delta);
            break;

          case 'done':
            break;
        }
      },
      signal
    );

    if (hasError || signal?.aborted) {
      finalText = turnText;
      break;
    }

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      finalText = turnText;
      onDelta({ type: 'done' });
      lastIterationHadToolCalls = false;
      break;
    }

    lastIterationHadToolCalls = true;

    // Build the assistant message with tool_use blocks
    const assistantBlocks: ContentBlock[] = [];
    if (turnText) {
      assistantBlocks.push({ type: 'text', text: turnText });
    }
    for (const tc of toolCalls) {
      assistantBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.args,
      });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    // Execute each tool and collect results
    const toolResultBlocks: ContentBlock[] = [];
    for (const tc of toolCalls) {
      if (signal?.aborted) break;

      const result = await executeTool({ name: tc.name, arguments: tc.args });

      onDelta({
        type: 'tool_result',
        toolName: tc.name,
        toolResult: result,
      });

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: JSON.stringify(result.data ?? result.error ?? 'done'),
        is_error: !result.success,
      });
    }

    // Append tool results as a user message (Anthropic convention)
    messages.push({ role: 'user', content: toolResultBlocks });

    finalText = turnText;
  }

  // Safety: if we hit max iterations with tool calls still pending
  if (iterations >= MAX_ITERATIONS && lastIterationHadToolCalls) {
    const warningText = '\n\n[Reached maximum tool-use iterations. Some operations may be incomplete.]';
    onDelta({ type: 'text', content: warningText });
    finalText += warningText;
    onDelta({ type: 'done' });
  }

  return finalText;
}
