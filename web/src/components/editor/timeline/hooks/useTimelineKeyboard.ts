"use client";

import { useEffect } from "react";
import { useEditorStore, withUndo } from "@/lib/store/editor-store";
import { useShallow } from "zustand/react/shallow";
import { executeAction } from "@/lib/commands/command-handler";

/**
 * Global timeline keyboard shortcuts:
 *   V — select tool · C — razor tool · ⌘B — cut selection at playhead
 *   Delete/Backspace — delete selection · ⌘L — toggle link · ⌘+/− — zoom
 * Self-subscribing: mount once from the Timeline component.
 */
export function useTimelineKeyboard(): void {
  const selectedClipIds = useEditorStore(useShallow((s) => s.ui.selectedClipIds));
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const pixelsPerSecond = useEditorStore((s) => s.timeline.pixelsPerSecond);
  const removeClip = useEditorStore((s) => s.removeClip);
  const toggleLinkForSelection = useEditorStore((s) => s.toggleLinkForSelection);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "v":
        case "V":
          setActiveTool("select");
          break;
        case "c":
        case "C":
          if (!e.metaKey && !e.ctrlKey) {
            setActiveTool("razor");
          }
          break;
        case "b":
        case "B":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            for (const clipId of selectedClipIds) {
              executeAction({ type: "cut", clipId, time: currentTime });
            }
          }
          break;
        case "Delete":
        case "Backspace":
          if (selectedClipIds.length > 0 && !e.metaKey && !e.ctrlKey) {
            withUndo("Delete clips", () => {
              for (const clipId of [...selectedClipIds]) {
                removeClip(clipId);
              }
            });
          }
          break;
        case "l":
        case "L":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (selectedClipIds.length > 0) {
              withUndo("Toggle link", () => toggleLinkForSelection());
            }
          }
          break;
        case "=":
        case "+":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setTimelineZoom(pixelsPerSecond * 1.3);
          }
          break;
        case "-":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setTimelineZoom(pixelsPerSecond / 1.3);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedClipIds,
    currentTime,
    pixelsPerSecond,
    removeClip,
    toggleLinkForSelection,
    setActiveTool,
    setTimelineZoom,
  ]);
}
