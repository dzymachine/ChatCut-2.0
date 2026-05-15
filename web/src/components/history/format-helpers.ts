/**
 * Shared formatting helpers for the edit history UI.
 *
 * Extracted so both the linear list (EditHistoryPanel) and the DAG
 * visualization (NodeDetailPanel, etc.) can reuse them.
 */

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.floor(diffHours / 24)}d ago`;
}

export function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatArgs(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  switch (toolName) {
    case 'apply_effect': {
      const effectId = args.effect_id as string;
      const params = args.parameters as Record<string, number> | undefined;
      if (!effectId) return null;
      const name = effectId.replace(/_/g, ' ');
      if (params && Object.keys(params).length > 0) {
        const paramStr = Object.entries(params)
          .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
          .join(', ');
        return `${name} (${paramStr})`;
      }
      return name;
    }
    case 'update_effect_param': {
      const params = args.parameters as Record<string, number> | undefined;
      if (params) {
        return Object.entries(params)
          .map(([k, v]) => `${k} = ${typeof v === 'number' ? v.toFixed(2) : v}`)
          .join(', ');
      }
      return null;
    }
    case 'trim_clip': {
      const parts: string[] = [];
      if (args.source_start != null)
        parts.push(`start: ${Number(args.source_start).toFixed(1)}s`);
      if (args.source_end != null)
        parts.push(`end: ${Number(args.source_end).toFixed(1)}s`);
      return parts.length > 0 ? parts.join(', ') : null;
    }
    case 'move_clip':
      return args.timeline_start != null
        ? `to ${Number(args.timeline_start).toFixed(1)}s`
        : null;
    case 'remove_clip':
      return args.clip_id
        ? `clip ${(args.clip_id as string).slice(0, 8)}`
        : null;
    default:
      return null;
  }
}

export const EFFECT_TOOLS = new Set(['apply_effect', 'update_effect_param']);
