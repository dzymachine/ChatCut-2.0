import { useSettingsStore } from '@/lib/store/settings-store';
import { useEditorStore } from '@/lib/store/editor-store';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export async function summarizeEditNode(
  nodeId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<void> {
  const anthropicKey = useSettingsStore.getState().apiKeys.anthropic;
  if (!anthropicKey) return;

  const argsDigest = JSON.stringify(args, null, 2).slice(0, 500);

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: anthropicKey, dangerouslyAllowBrowser: true });

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 60,
      messages: [
        {
          role: 'user',
          content: `Summarize this video edit in one short sentence (max 10 words). Tool: ${toolName}. Arguments: ${argsDigest}`,
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => ('text' in b ? b.text : ''))
      .join('')
      .trim();

    if (text) {
      useEditorStore.getState().updateEditNodeSummary(nodeId, text);
    }
  } catch {
    // Degrade silently — the tool name is shown instead
  }
}
