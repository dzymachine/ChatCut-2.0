/**
 * Gemini Provider Adapter
 *
 * Uses the @google/generative-ai SDK for streaming tool-use.
 * Model: gemini-2.5-pro (default)
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type FunctionDeclarationSchemaProperty,
  type Part,
} from '@google/generative-ai';
import type { ToolDef } from '../../../../src-shared/tools';
import type { LLMProvider, Message, StreamDelta } from './index';
import { handleStreamError } from './provider-error';
import { SYSTEM_PROMPT } from './system-prompt';

const DEFAULT_MODEL = 'gemini-2.5-pro';

/** Map one of our tool parameters to a Gemini schema property. */
function toSchemaProperty(param: {
  type: string;
  description: string;
  enum?: string[];
}): FunctionDeclarationSchemaProperty {
  if (param.enum) {
    return {
      type: SchemaType.STRING,
      format: 'enum',
      enum: param.enum,
      description: param.description,
    };
  }
  switch (param.type) {
    case 'number':
      return { type: SchemaType.NUMBER, description: param.description };
    case 'boolean':
      return { type: SchemaType.BOOLEAN, description: param.description };
    case 'object':
      // Free-form object parameter (e.g. apply_effect.parameters). The SDK's
      // ObjectSchema type demands `properties`, but the Gemini API accepts a
      // bare OBJECT declaration — and an empty properties map makes some
      // models reject the schema. The cast preserves the wire format.
      return {
        type: SchemaType.OBJECT,
        description: param.description,
      } as FunctionDeclarationSchemaProperty;
    default:
      return { type: SchemaType.STRING, description: param.description };
  }
}

/** Convert our internal tool format to Gemini function declarations. */
function convertTools(tools: ToolDef[]): FunctionDeclaration[] {
  return tools.map((tool) => {
    const properties: Record<string, FunctionDeclarationSchemaProperty> = {};
    const required: string[] = [];

    for (const [key, param] of Object.entries(tool.parameters)) {
      properties[key] = toSchemaProperty(param);
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
function convertMessages(messages: Message[]): Content[] {
  const result: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      result.push({ role, parts: [{ text: msg.content }] });
      continue;
    }

    // Handle block-based content
    const parts: Part[] = [];
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
    } catch (error: unknown) {
      handleStreamError(error, 'Gemini', onDelta, signal);
    }
  }
}
