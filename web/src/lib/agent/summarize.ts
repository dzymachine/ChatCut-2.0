import { useSettingsStore } from '@/lib/store/settings-store';
import { useEditorStore } from '@/lib/store/editor-store';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export async function summarizeEditNode(
  nodeId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<void> {
  const settings = useSettingsStore.getState();
  // Edit-node summaries hardcode the Anthropic SDK + Haiku model + Anthropic
  // key. Only run when Anthropic is the active provider — otherwise we'd fire
  // hidden cross-provider calls for Groq/Gemini users who happen to have an
  // Anthropic key configured.
  if (settings.provider !== 'anthropic') return;
  const anthropicKey = settings.apiKeys.anthropic;
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
  } catch (err) {
    // Degrade gracefully in the UI (the tool name is shown instead), but log
    // so a broken key/model/network failure isn't completely invisible.
    console.warn('[summarize] edit-node summary failed:', err);
  }
}
