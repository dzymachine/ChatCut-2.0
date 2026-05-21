/**
 * Gemini Provider Adapter
 *
 * Uses the @google/generative-ai SDK for streaming tool-use.
 * Model: gemini-2.5-pro (default)
 */

import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import type { ToolDef } from '../../../../src-shared/tools';
import type { LLMProvider, Message, StreamDelta } from './index';

const DEFAULT_MODEL = 'gemini-2.5-pro';

const SYSTEM_PROMPT = `You are ChatCut, an AI video editor. You edit video by calling tools. Always use the available tools to fulfill the user's request. Check the timeline state first with get_timeline_state if you need context about what's on the timeline.

When using apply_effect, the parameters object must use the effect's specific parameter ID as the key:
- brightness: { brightness: <number> } where 0 is normal, positive is brighter, negative is darker
- contrast: { contrast: <number> } where 1.0 is normal
- saturation: { saturation: <number> } where 1.0 is normal
- gaussian_blur: { sigma: <number> }
- opacity: { opacity: <number> } range 0 to 1
- scale: { scale: <number> } where 1.0 is 100%
- rotation: { degrees: <number> }

You can omit clip_id — it defaults to the active/first clip.`;

/** Map our parameter types to Gemini schema types. */
function mapType(type: string): SchemaType {
  switch (type) {
    case 'string': return SchemaType.STRING;
    case 'number': return SchemaType.NUMBER;
    case 'boolean': return SchemaType.BOOLEAN;
    case 'object': return SchemaType.OBJECT;
    default: return SchemaType.STRING;
  }
}

/** Convert our internal tool format to Gemini function declarations. */
function convertTools(tools: ToolDef[]): FunctionDeclaration[] {
  return tools.map((tool) => {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, param] of Object.entries(tool.parameters)) {
      const prop: any = {
        type: mapType(param.type),
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
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties,
        required: required.length > 0 ? required : undefined,
      },
    };
  });
}

/** Convert internal messages to Gemini content format. */
function convertMessages(messages: Message[]): Array<{ role: string; parts: any[] }> {
  const result: Array<{ role: string; parts: any[] }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      result.push({ role, parts: [{ text: msg.content }] });
      continue;
    }

    // Handle block-based content
    const parts: any[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'tool_use') {
        parts.push({
          functionCall: { name: block.name, args: block.input },
        });
      } else if (block.type === 'tool_result') {
        parts.push({
          functionResponse: {
            name: '', // Gemini infers from context
            response: { content: block.content },
          },
        });
      }
    }

    if (parts.length > 0) {
      result.push({ role, parts });
    }
  }

  return result;
}

export class GeminiProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model || DEFAULT_MODEL;
  }

  async streamTurn(
    messages: Message[],
    tools: ToolDef[],
    onDelta: (delta: StreamDelta) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const geminiTools = convertTools(tools);
    const geminiMessages = convertMessages(messages);

    try {
      const model = this.genAI.getGenerativeModel({
        model: this.model,
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: geminiTools }],
      });

      const chat = model.startChat({
        history: geminiMessages.slice(0, -1),
      });

      // Get the last message to send
      const lastMessage = geminiMessages[geminiMessages.length - 1];
      if (!lastMessage) {
        onDelta({ type: 'done' });
        return;
      }

      const result = await chat.sendMessageStream(lastMessage.parts);

      for await (const chunk of result.stream) {
        if (signal?.aborted) break;

        const candidates = chunk.candidates;
        if (!candidates || candidates.length === 0) continue;

        const parts = candidates[0].content?.parts;
        if (!parts) continue;

        for (const part of parts) {
          if ('text' in part && part.text) {
            onDelta({ type: 'text', content: part.text });
          }
          if ('functionCall' in part && part.functionCall) {
            onDelta({
              type: 'tool_use_start',
              toolName: part.functionCall.name,
              toolArgs: part.functionCall.args as Record<string, unknown>,
            });
            onDelta({ type: 'tool_use_end', toolName: part.functionCall.name });
          }
        }
      }

      onDelta({ type: 'done' });
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal?.aborted) {
        onDelta({ type: 'done' });
        return;
      }
      onDelta({
        type: 'error',
        content: error?.message || 'Gemini API error',
      });
    }
  }
}
