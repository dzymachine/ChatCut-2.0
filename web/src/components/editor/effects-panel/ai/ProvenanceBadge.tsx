'use client';

import type { ProvenanceEntry } from '@/types/editor';

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const sourceConfig = {
  ai: {
    label: 'Set by AI',
    classes: 'bg-purple-500/20 text-purple-400',
  },
  user: {
    label: 'Set by you',
    classes: 'bg-neutral-500/20 text-neutral-400',
  },
  'ai-suggested': {
    label: 'AI suggestion (pending)',
    classes: 'bg-amber-500/20 text-amber-400',
  },
} as const;

function RobotIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="8" y1="0" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="0.5" r="1" fill="currentColor" />
      <rect x="3" y="4" width="10" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="6" cy="8.5" r="1" fill="currentColor" />
      <circle cx="10" cy="8.5" r="1" fill="currentColor" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M2.5 15C2.5 11.5 5 9.5 8 9.5C11 9.5 13.5 11.5 13.5 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function ProvenanceBadge({ entry }: { entry: ProvenanceEntry }) {
  const config = sourceConfig[entry.source];
  const isAiSource = entry.source === 'ai' || entry.source === 'ai-suggested';
  const isPending = entry.source === 'ai-suggested';

  return (
    <div className="group relative inline-flex">
      <div
        className={`w-4 h-4 rounded-full flex items-center justify-center ${config.classes}${
          isPending ? ' animate-pulse' : ''
        }`}
      >
        {isAiSource ? <RobotIcon /> : <PersonIcon />}
      </div>

      <div
        className={
          'hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 ' +
          'bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1.5 text-[10px] ' +
          'shadow-lg z-50 min-w-[120px]'
        }
      >
        <p className="whitespace-nowrap text-neutral-200 font-medium">
          {config.label}
        </p>
        {entry.source === 'ai' && entry.aiReason && (
          <p className="mt-0.5 text-neutral-400 whitespace-normal break-words">
            {entry.aiReason}
          </p>
        )}
        <p className="mt-0.5 text-neutral-500 whitespace-nowrap">
          {relativeTime(entry.timestamp)}
        </p>
      </div>
    </div>
  );
}
