"use client";

import { useState } from "react";

interface ToolCallCardProps {
  toolName: string;
  args?: Record<string, unknown>;
  result?: { success: boolean; data?: unknown; error?: string };
}

export function ToolCallCard({ toolName, args, result }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="my-1.5 rounded-md border border-neutral-700 bg-neutral-850 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-neutral-800 transition-colors"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-neutral-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-xs font-mono text-blue-400">{toolName}</span>
        {result && (
          <span
            className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
              result.success
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {result.success ? "success" : "error"}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 py-2 border-t border-neutral-700 space-y-2">
          {args && Object.keys(args).length > 0 && (
            <div>
              <span className="text-[10px] uppercase text-neutral-500 font-medium">
                Arguments
              </span>
              <pre className="mt-1 text-xs text-neutral-300 font-mono bg-neutral-900 rounded p-2 overflow-x-auto">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <span className="text-[10px] uppercase text-neutral-500 font-medium">
                Result
              </span>
              <pre
                className={`mt-1 text-xs font-mono rounded p-2 overflow-x-auto ${
                  result.success
                    ? "text-emerald-300 bg-emerald-950/30"
                    : "text-red-300 bg-red-950/30"
                }`}
              >
                {result.error
                  ? result.error
                  : JSON.stringify(result.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
