"use client";

import { VideoPreview } from "@/components/editor/VideoPreview";
import { VideoLibrary } from "@/components/editor/VideoLibrary";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { FloatingChatPanel } from "@/components/chat/FloatingChatPanel";
import { EditHistoryPanel } from "@/components/history/EditHistoryPanel";
import { Timeline } from "@/components/editor/timeline/Timeline";
import { ExportDialog } from "@/components/editor/export/ExportDialog";
import { ProviderPicker } from "@/components/settings/ProviderPicker";
import { ApiKeySetting } from "@/components/settings/ApiKeySetting";
import { useEditorStore } from "@/lib/store/editor-store";
import { useTauriStatus } from "@/hooks/useTauriStatus";
import { saveProject, loadProject, startAutoSave, stopAutoSave } from "@/lib/project/serializer";
import { useCallback, useEffect, useState } from "react";
import { showToast } from "@/components/ui/toast-notification";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

export default function EditorPage() {
  const canUndo = useEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useEditorStore((s) => s.redoStack.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const [, setEngineReady] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatFloating, setIsChatFloating] = useState(false);
  const [isHistoryFloating, setIsHistoryFloating] = useState(false);
  const tauriStatus = useTauriStatus();

  // Persist popout state across reloads.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("chatcut.chatFloating");
      if (raw === "true") setIsChatFloating(true);
      const rawH = window.localStorage.getItem("chatcut.historyFloating");
      if (rawH === "true") setIsHistoryFloating(true);
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("chatcut.chatFloating", String(isChatFloating));
      window.localStorage.setItem("chatcut.historyFloating", String(isHistoryFloating));
    } catch {
      // ignore
    }
  }, [isChatFloating]);

  const handleEngineReady = useCallback(() => {
    setEngineReady(true);
  }, []);

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

  const handleLoad = useCallback(async () => {
    try {
      await loadProject();
    } catch (err) {
      console.error("Load failed:", err);
      showToast("error", "Failed to load project");
    }
  }, []);

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
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        handleLoad();
      }
      // "/" focuses the chat input from anywhere
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const chatInput = document.querySelector<HTMLInputElement>('[data-chat-input]');
        chatInput?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleSave, handleLoad]);

  useEffect(() => {
    startAutoSave(60_000);
    return () => stopAutoSave();
  }, []);

  return (
    <div className="h-screen flex flex-col bg-neutral-950">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-white tracking-tight">ChatCut</h1>
          {tauriStatus.isDesktop && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[10px] font-medium">
              Desktop
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleLoad} className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors" title="Open Project (Cmd+O)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z" /></svg>
          </button>
          <button onClick={handleSave} className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors" title="Save Project (Cmd+S)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
          </button>
          {saveStatus === "saving" && <span className="text-[10px] text-neutral-500">Saving...</span>}
          {saveStatus === "saved" && <span className="text-[10px] text-emerald-400">Saved</span>}
          <span className="text-xs text-neutral-700 mx-0.5">|</span>
          <button onClick={() => setIsExportOpen(true)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors" title="Export Video">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Export
          </button>
          <span className="text-xs text-neutral-700 mx-0.5">|</span>
          <button onClick={undo} disabled={!canUndo} className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Undo (Cmd+Z)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6" /><path d="M3 13a9 9 0 019-9 9 9 0 016.3 2.6L21 9" /></svg>
          </button>
          <button onClick={redo} disabled={!canRedo} className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Redo (Cmd+Shift+Z)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6" /><path d="M21 13a9 9 0 00-9-9 9 9 0 00-6.3 2.6L3 9" /></svg>
          </button>
          <span className="text-xs text-neutral-700 mx-0.5">|</span>
          <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors" title="AI Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
          </button>
        </div>
      </header>

      {/* Main resizable layout: top (preview + panels) / bottom (timeline) */}
      <PanelGroup direction="vertical" id="outer" className="flex-1 min-h-0">
        {/* Top section: library | preview + chat | history */}
        <Panel defaultSize={65} minSize={25}>
          <PanelGroup direction="horizontal" id="top" className="h-full">
            {/* Library — 20% default, can collapse */}
            <Panel defaultSize={20} minSize={5} maxSize={40} collapsible collapsedSize={4}>
              <div className="h-full border-r border-neutral-800 bg-neutral-950 overflow-auto">
                <VideoLibrary />
              </div>
            </Panel>
            <PanelResizeHandle className="w-1.5 bg-neutral-800 hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors cursor-col-resize" />

            {/* Center: Preview alone when chat is floating, otherwise
                Preview + Chat stacked — 55% */}
            <Panel defaultSize={55} minSize={20}>
              {isChatFloating ? (
                <VideoPreview onEngineReady={handleEngineReady} />
              ) : (
                <PanelGroup direction="vertical" id="center" className="h-full">
                  <Panel defaultSize={55} minSize={15}>
                    <VideoPreview onEngineReady={handleEngineReady} />
                  </Panel>
                  <PanelResizeHandle className="h-1.5 bg-neutral-800 hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors cursor-row-resize" />
                  <Panel defaultSize={45} minSize={10}>
                    <div className="h-full border-l border-neutral-800">
                      <ChatPanel onPopOut={() => setIsChatFloating(true)} />
                    </div>
                  </Panel>
                </PanelGroup>
              )}
            </Panel>

            {/* Edit History — 25% default, can collapse; hidden when floating */}
            {!isHistoryFloating && (
              <>
                <PanelResizeHandle className="w-1.5 bg-neutral-800 hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors cursor-col-resize" />
                <Panel defaultSize={25} minSize={5} maxSize={40} collapsible collapsedSize={0}>
                  <div className="h-full border-l border-neutral-800 overflow-auto">
                    <EditHistoryPanel onPopOut={() => setIsHistoryFloating(true)} />
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="h-1.5 bg-neutral-800 hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors cursor-row-resize" />

        {/* Timeline — 35% default, generous range */}
        <Panel defaultSize={35} minSize={10} maxSize={70}>
          <Timeline />
        </Panel>
      </PanelGroup>

      {/* Floating Chat Panel — rendered outside the resizable layout so it
          overlays everything and can be dragged anywhere on screen. */}
      {isChatFloating && (
        <FloatingChatPanel onDock={() => setIsChatFloating(false)}>
          <ChatPanel isFloating />
        </FloatingChatPanel>
      )}

      {/* Floating Edit History Panel */}
      {isHistoryFloating && (
        <FloatingChatPanel
          onDock={() => setIsHistoryFloating(false)}
          title="Edit History"
          storageKey="chatcut.historyFloat"
        >
          <EditHistoryPanel isFloating />
        </FloatingChatPanel>
      )}

      {/* Export Dialog */}
      <ExportDialog isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} />

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-[360px] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-200">AI Settings</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <ProviderPicker />
            <ApiKeySetting />
          </div>
        </div>
      )}
    </div>
  );
}
