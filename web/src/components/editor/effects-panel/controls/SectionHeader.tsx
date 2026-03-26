"use client";

import { useState } from "react";
import { Collapsible } from "radix-ui";

interface SectionHeaderProps {
  title: string;
  defaultOpen?: boolean;
  onReset?: () => void;
  showReset?: boolean;
  children: React.ReactNode;
}

export function SectionHeader({
  title,
  defaultOpen = true,
  onReset,
  showReset = !!onReset,
  children,
}: SectionHeaderProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="py-1 border-b border-neutral-800/60">
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-1 py-1.5 cursor-pointer hover:bg-neutral-800/30 rounded"
        >
          <span className="flex items-center gap-1.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className={`w-3 h-3 text-neutral-500 transition-transform duration-150 ${open ? "rotate-90" : "rotate-0"}`}
            >
              <path d="M6 3l5 5-5 5V3z" />
            </svg>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {title}
            </span>
          </span>

          {showReset && onReset && (
            <span
              role="button"
              tabIndex={0}
              title={`Reset ${title}`}
              className="text-neutral-500 hover:text-neutral-300 p-0.5 rounded"
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onReset();
                }
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3 h-3"
              >
                <path d="M2.5 2.5v4h4" />
                <path d="M2.5 6.5a5.5 5.5 0 1 1 1.1-2" />
              </svg>
            </span>
          )}
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className="overflow-hidden">
        <div className="py-1.5">
          {children}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
