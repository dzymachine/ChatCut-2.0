"use client";

interface MultiClipHeaderProps {
  clips: Array<{ id: string; type: string }>;
}

export function MultiClipHeader({ clips }: MultiClipHeaderProps) {
  return (
    <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2">
        <FilmStripIcon />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-neutral-200">
            {clips.length} Clips Selected
          </span>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-400 flex-wrap">
            {clips.map((clip, i) => (
              <span key={clip.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-neutral-600">&bull;</span>}
                {clip.type}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-neutral-700/40">
        <p className="text-[10px] text-neutral-500 leading-relaxed">
          Changes apply as offsets to all selected clips
        </p>
      </div>
    </div>
  );
}

function FilmStripIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5 text-neutral-400 shrink-0"
    >
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
      <line x1="17" y1="17" x2="22" y2="17" />
    </svg>
  );
}
