"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FloatingChatPanelProps {
  children: React.ReactNode;
  onDock: () => void;
  title?: string;
  storageKey?: string;
}

interface FloatState {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STORAGE_KEY = "chatcut.chatFloat";
const MIN_WIDTH = 280;
const MIN_HEIGHT = 240;
const DEFAULT_FLOAT: FloatState = { x: 120, y: 120, width: 420, height: 560 };

function clampToViewport(state: FloatState): FloatState {
  if (typeof window === "undefined") return state;
  const maxX = Math.max(0, window.innerWidth - state.width);
  const maxY = Math.max(0, window.innerHeight - state.height);
  return {
    ...state,
    x: Math.min(Math.max(0, state.x), maxX),
    y: Math.min(Math.max(0, state.y), maxY),
  };
}

/**
 * Floating wrapper for the chat panel — fixed-positioned, draggable by the
 * header, resizable from the bottom-right corner. Position and size persist
 * in localStorage so the layout survives reloads. Does NOT actually leave
 * the main window (that's option A's job); option C is a same-window
 * detachment so we can ship without IPC plumbing for cross-window state.
 */
export function FloatingChatPanel({ children, onDock, title = "Chat", storageKey }: FloatingChatPanelProps) {
  const resolvedKey = storageKey ?? STORAGE_KEY;
  const [state, setState] = useState<FloatState>(() => {
    if (typeof window === "undefined") return DEFAULT_FLOAT;
    try {
      const raw = window.localStorage.getItem(resolvedKey);
      if (!raw) return DEFAULT_FLOAT;
      const parsed = JSON.parse(raw) as Partial<FloatState>;
      return clampToViewport({
        x: Number.isFinite(parsed.x) ? parsed.x! : DEFAULT_FLOAT.x,
        y: Number.isFinite(parsed.y) ? parsed.y! : DEFAULT_FLOAT.y,
        width: Math.max(MIN_WIDTH, parsed.width ?? DEFAULT_FLOAT.width),
        height: Math.max(MIN_HEIGHT, parsed.height ?? DEFAULT_FLOAT.height),
      });
    } catch {
      return DEFAULT_FLOAT;
    }
  });
  // Drag handlers read the latest committed state through this ref.
  // Synced in an effect (not during render) per the react-hooks/refs rule.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Persist on change
  useEffect(() => {
    try {
      window.localStorage.setItem(resolvedKey, JSON.stringify(state));
    } catch {
      // ignore quota / disabled storage
    }
  }, [state, resolvedKey]);

  // Re-clamp if the window resizes (keeps panel from drifting off-screen).
  useEffect(() => {
    const onResize = () => setState((s) => clampToViewport(s));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Shared mouse-drag harness — used for both move and resize. Returns a
  // mousedown handler that captures the starting state and registers
  // window-level move/up listeners. The transform fn maps the
  // (dx, dy, startState) tuple into the next FloatState.
  const beginDrag = useCallback(
    (
      transform: (dx: number, dy: number, start: FloatState) => FloatState,
    ) =>
      (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startState = stateRef.current;
        const onMove = (ev: MouseEvent) => {
          const next = transform(ev.clientX - startX, ev.clientY - startY, startState);
          setState(clampToViewport(next));
        };
        const onEnd = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onEnd);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onEnd);
      },
    [],
  );

  const onDragStart = beginDrag((dx, dy, start) => ({
    ...start,
    x: start.x + dx,
    y: start.y + dy,
  }));

  const onResizeStart = beginDrag((dx, dy, start) => ({
    ...start,
    width: Math.max(MIN_WIDTH, start.width + dx),
    height: Math.max(MIN_HEIGHT, start.height + dy),
  }));

  return (
    <div
      className="fixed z-40 flex flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl overflow-hidden"
      style={{
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height,
      }}
    >
      {/* Drag handle / title bar */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center justify-between gap-2 px-3 py-1.5 bg-neutral-850 border-b border-neutral-700 cursor-move select-none"
        style={{ background: "rgb(31, 31, 31)" }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          {title}
        </span>
        <button
          onClick={onDock}
          className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
          title="Dock chat panel"
          aria-label="Dock chat panel"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
          </svg>
        </button>
      </div>

      {/* Embedded chat panel */}
      <div className="flex-1 min-h-0 min-w-0">{children}</div>

      {/* Resize handle (bottom-right corner) */}
      <div
        onMouseDown={onResizeStart}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, rgb(82, 82, 82) 50%)",
        }}
        aria-label="Resize chat panel"
      />
    </div>
  );
}
