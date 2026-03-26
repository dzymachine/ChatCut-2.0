'use client';

import { useState, useMemo } from 'react';
import { useEditorStore } from '@/lib/store/editor-store';
import type { ClipProvenance, ProvenanceEntry } from '@/types/editor';

interface AIChangesBarProps {
  clipId: string;
  provenance: ClipProvenance;
}

const PATH_LABELS: Record<string, string> = {
  'transform.scale': 'Scale',
  'transform.positionX': 'Position X',
  'transform.positionY': 'Position Y',
  'transform.rotation': 'Rotation',
  'transform.opacity': 'Opacity',
  'transform.filters.blur': 'Blur',
  'transform.filters.brightness': 'Brightness',
  'transform.filters.contrast': 'Contrast',
  'transform.filters.saturate': 'Saturation',
  'transform.filters.grayscale': 'Grayscale',
  'transform.filters.sepia': 'Sepia',
  'transform.filters.hueRotate': 'Hue',
};

function labelForPath(path: string): string {
  if (PATH_LABELS[path]) return PATH_LABELS[path];
  if (path.startsWith('effect:')) {
    const segments = path.split('.');
    const last = segments[segments.length - 1];
    return last.charAt(0).toUpperCase() + last.slice(1);
  }
  return path;
}

const PERCENTAGE_PATHS = new Set([
  'transform.scale',
  'transform.opacity',
  'transform.filters.grayscale',
  'transform.filters.sepia',
]);

function formatValue(path: string, value: number | string | boolean | null): string {
  if (value === null) return 'none';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (PERCENTAGE_PATHS.has(path)) return `${Math.round(value * 100)}%`;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function RobotIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-purple-400"
    >
      <line x1="8" y1="0" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="0.5" r="1" fill="currentColor" />
      <rect x="3" y="4" width="10" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="6" cy="8.5" r="1" fill="currentColor" />
      <circle cx="10" cy="8.5" r="1" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
    >
      <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AIChangesBar({ clipId, provenance }: AIChangesBarProps) {
  const [collapsed, setCollapsed] = useState(false);

  const acceptAIChange = useEditorStore((s) => s.acceptAIChange);
  const revertAIChange = useEditorStore((s) => s.revertAIChange);
  const acceptAllAIChanges = useEditorStore((s) => s.acceptAllAIChanges);
  const revertAllAIChanges = useEditorStore((s) => s.revertAllAIChanges);

  const { aiEntries, uniqueReasons, allAccepted } = useMemo(() => {
    const entries: [string, ProvenanceEntry][] = [];
    for (const [path, entry] of Object.entries(provenance)) {
      if (entry.source === 'ai' || entry.source === 'ai-suggested') {
        entries.push([path, entry]);
      }
    }
    const reasons = new Set<string>();
    for (const [, entry] of entries) {
      if (entry.aiReason) reasons.add(entry.aiReason);
    }
    return {
      aiEntries: entries,
      uniqueReasons: [...reasons],
      allAccepted: entries.length > 0 && entries.every(([, e]) => e.accepted),
    };
  }, [provenance]);

  if (aiEntries.length === 0) return null;

  return (
    <div className="border-t border-purple-500/30 bg-purple-950/10">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-1.5">
          <ChevronIcon expanded={!collapsed} />
          <RobotIcon />
          <span className="text-[11px] font-medium text-purple-300">AI Changes</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 font-mono">
            {aiEntries.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
            onClick={() => acceptAllAIChanges(clipId)}
          >
            Accept All
          </button>
          <button
            className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            onClick={() => revertAllAIChanges(clipId)}
          >
            Revert All
          </button>
        </div>
      </div>

      {/* Change list */}
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {allAccepted ? (
            <div className="flex items-center gap-1.5 text-[11px] text-green-400">
              <CheckIcon />
              <span>All accepted</span>
            </div>
          ) : (
            aiEntries.map(([path, entry]) => (
              <div
                key={path}
                className={`flex items-center justify-between text-[11px] ${
                  entry.accepted ? 'opacity-40' : ''
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-neutral-300 font-mono truncate">
                    {labelForPath(path)}
                  </span>
                  <span className="text-neutral-500 truncate">
                    was {formatValue(path, entry.previousValue)}
                  </span>
                </div>

                {entry.accepted ? (
                  <span className="text-green-500/60 flex-shrink-0 ml-2">
                    <CheckIcon />
                  </span>
                ) : (
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-green-400 hover:bg-green-500/10 transition-colors"
                      onClick={() => acceptAIChange(clipId, path)}
                      title="Accept"
                    >
                      <CheckIcon />
                    </button>
                    <button
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                      onClick={() => revertAIChange(clipId, path)}
                      title="Undo"
                    >
                      <XIcon />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}

          {uniqueReasons.length > 0 && (
            <div className="pt-1">
              {uniqueReasons.map((reason) => (
                <p key={reason} className="text-[10px] italic text-purple-400/70 px-2 pb-2">
                  &ldquo;{reason}&rdquo;
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
