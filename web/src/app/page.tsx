"use client";

import { VideoPreview } from "@/components/editor/VideoPreview";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Timeline } from "@/components/editor/timeline/Timeline";
import { ExportDialog } from "@/components/editor/export/ExportDialog";
import { useEditorStore } from "@/lib/store/editor-store";
import { useTauriStatus } from "@/hooks/useTauriStatus";
import { saveProject, loadProject, startAutoSave, stopAutoSave } from "@/lib/project/serializer";
import { useCallback, useEffect, useState } from "react";
import { showToast } from "@/components/ui/toast-notification";

export default function EditorPage() {
  const isChatOpen = useEditorStore((s) => s.ui.isChatOpen);
  const toggleChat = useEditorStore((s) => s.toggleChat);
  const canUndo = useEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useEditorStore((s) => s.redoStack.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const [, setEngineReady] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const tauriStatus = useTauriStatus();

  const handleEngineReady = useCallback(() => {
    setEngineReady(true);
  }, []);

  // Save project handler
  const handleSave = useCallback(async () => {
    try {
      setSaveStatus("saving");
      const path = await saveProject();
      if (path) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setSaveStatus(null);
      }
    } catch (err) {
      console.error("Save failed:", err);
      showToast("error", "Failed to save project");
      setSaveStatus(null);
    }
  }, []);

  // Load project handler
  const handleLoad = useCallback(async () => {
    try {
      await loadProject();
    } catch (err) {
      console.error("Load failed:", err);
      showToast("error", "Failed to load project");
    }
  }, []);

  // Keyboard shortcuts for undo/redo and save
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          useEditorStore.getState().redo();
        } else {
          useEditorStore.getState().undo();
        }
      }

      // Cmd+S / Ctrl+S — save project
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }

      // Cmd+O / Ctrl+O — open project
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        handleLoad();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleSave, handleLoad]);

  // Start auto-save on mount
  useEffect(() => {
    startAutoSave(60_000); // Auto-save every 60 seconds
    return () => stopAutoSave();
  }, []);

  return (
    <div className="h-screen flex flex-col bg-neutral-950">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-white tracking-tight">
            ChatCut
          </h1>
          <span className="text-xs text-neutral-600">|</span>
          <span className="text-xs text-neutral-500">AI Video Editor</span>
          {tauriStatus.isDesktop && (
            <>
              <span className="text-xs text-neutral-700">|</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[10px] font-medium">
                Desktop
              </span>
              {tauriStatus.ffmpeg !== null && (
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    tauriStatus.ffmpeg.available
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}
                  title={tauriStatus.ffmpeg.available ? tauriStatus.ffmpeg.version : "FFmpeg not found — export disabled"}
                >
                  FFmpeg {tauriStatus.ffmpeg.available ? "✓" : "✗"}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* File Operations */}
          <button
            onClick={handleLoad}
            className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title="Open Project (Cmd+O)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z" />
            </svg>
          </button>
          <button
            onClick={handleSave}
            className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title="Save Project (Cmd+S)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          </button>
          {saveStatus === "saving" && (
            <span className="text-[10px] text-neutral-500">Saving...</span>
          )}
          {saveStatus === "saved" && (
            <span className="text-[10px] text-emerald-400">Saved</span>
          )}

          <span className="text-xs text-neutral-700 mx-0.5">|</span>

          {/* Export Button */}
          <button
            onClick={() => setIsExportOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors"
            title="Export Video"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>

          <span className="text-xs text-neutral-700 mx-1">|</span>

          {/* Undo/Redo */}
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Undo (Cmd+Z)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 7v6h6" />
              <path d="M3 13a9 9 0 019-9 9 9 0 016.3 2.6L21 9" />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Redo (Cmd+Shift+Z)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 7v6h-6" />
              <path d="M21 13a9 9 0 00-9-9 9 9 0 00-6.3 2.6L3 9" />
            </svg>
          </button>

          <span className="text-xs text-neutral-700 mx-1">|</span>

          {/* Chat Toggle */}
          <button
            onClick={toggleChat}
            className={`p-1.5 rounded transition-colors ${
              isChatOpen
                ? "text-blue-400 bg-blue-500/10"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            }`}
            title="Toggle Chat Panel"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Editor Area — video preview + optional chat panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Video Preview — takes remaining space */}
        <div className="flex-1 flex flex-col min-w-0">
          <VideoPreview onEngineReady={handleEngineReady} />
        </div>

        {/* Chat Panel — fixed width sidebar */}
        {isChatOpen && (
          <div className="w-[360px] shrink-0">
            <ChatPanel />
          </div>
        )}
      </div>

      {/* Timeline Panel — full width at bottom, resizable */}
      <Timeline />

      {/* Export Dialog */}
      <ExportDialog isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} />
    </div>
  );
}
