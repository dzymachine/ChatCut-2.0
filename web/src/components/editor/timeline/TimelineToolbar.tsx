"use client";

import { useCallback } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import type { TimelineTool } from "@/types/editor";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TimelineToolbarProps {
  onZoomToFit: () => void;
}

/**
 * Toolbar above the timeline — tool selector, snap toggle, zoom controls.
 */
export function TimelineToolbar({ onZoomToFit }: TimelineToolbarProps) {
  const activeTool = useEditorStore((s) => s.timeline.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const snapEnabled = useEditorStore((s) => s.timeline.snapEnabled);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);
  const pixelsPerSecond = useEditorStore((s) => s.timeline.pixelsPerSecond);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const selectedClipId = useEditorStore((s) => s.ui.selectedClipId);
  const splitClip = useEditorStore((s) => s.splitClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const addTrack = useEditorStore((s) => s.addTrack);

  const handleZoomIn = useCallback(() => {
    setTimelineZoom(pixelsPerSecond * 1.3);
  }, [pixelsPerSecond, setTimelineZoom]);

  const handleZoomOut = useCallback(() => {
    setTimelineZoom(pixelsPerSecond / 1.3);
  }, [pixelsPerSecond, setTimelineZoom]);

  const handleSplit = useCallback(() => {
    if (selectedClipId) {
      splitClip(selectedClipId, currentTime);
    }
  }, [selectedClipId, splitClip, currentTime]);

  const handleDelete = useCallback(() => {
    if (selectedClipId) {
      removeClip(selectedClipId);
    }
  }, [selectedClipId, removeClip]);

  const tools: Array<{ id: TimelineTool; label: string; icon: React.ReactNode; shortcut: string }> = [
    {
      id: "select",
      label: "Select",
      shortcut: "V",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        </svg>
      ),
    },
    {
      id: "razor",
      label: "Razor",
      shortcut: "C",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v18M5 8l14 8M5 16l14-8" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-neutral-900 border-b border-neutral-800 shrink-0">
      {/* Tool Selector */}
      <div className="flex items-center gap-0.5 mr-2">
        {tools.map((tool) => (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool(tool.id)}
                className={`p-1.5 rounded transition-colors ${
                  activeTool === tool.id
                    ? "bg-blue-500/20 text-blue-400"
                    : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {tool.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{tool.label} ({tool.shortcut})</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-neutral-700 mx-1" />

      {/* Snap Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`p-1.5 rounded transition-colors flex items-center gap-1 ${
              snapEnabled
                ? "bg-blue-500/20 text-blue-400"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 14l-3-3h-7a1 1 0 01-1-1V3" />
              <path d="M14 4l-3 3 3 3" />
              <path d="M3 10l3 3h7a1 1 0 011 1v7" />
            </svg>
            <span className="text-[10px] font-medium">Snap</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Magnetic Snap ({snapEnabled ? "On" : "Off"})</p>
        </TooltipContent>
      </Tooltip>

      {/* Divider */}
      <div className="w-px h-4 bg-neutral-700 mx-1" />

      {/* Split / Delete */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleSplit}
            disabled={!selectedClipId}
            className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M2 12h4M18 12h4" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Split at Playhead (Cmd+B)</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleDelete}
            disabled={!selectedClipId}
            className="p-1.5 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Delete Clip (Del)</p>
        </TooltipContent>
      </Tooltip>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Add Track */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => addTrack("video")}
            className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Add Track</p>
        </TooltipContent>
      </Tooltip>

      {/* Divider */}
      <div className="w-px h-4 bg-neutral-700 mx-1" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35M8 11h6" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Zoom Out</p>
          </TooltipContent>
        </Tooltip>

        {/* Zoom level indicator */}
        <span className="text-[10px] text-neutral-500 font-mono min-w-[36px] text-center">
          {Math.round(pixelsPerSecond)}x
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Zoom In</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onZoomToFit}
              className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Zoom to Fit</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
