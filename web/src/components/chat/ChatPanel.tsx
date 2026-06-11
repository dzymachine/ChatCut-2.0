"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import { runAgentLoop, type StreamDelta } from "@/lib/agent/loop";
import type { ToolCallInfo } from "@/types/editor";
import { ChatMessage } from "./ChatMessage";
import { ToolCallCard } from "./ToolCallCard";
import { EmptyState } from "./EmptyState";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast-notification";

interface ChatPanelProps {
  /** True when ChatPanel is rendered inside FloatingChatPanel. Hides the
   *  panel's own header (the floating wrapper provides its own title bar)
   *  and swaps the popout icon for a no-op (the wrapper exposes the dock
   *  button). */
  isFloating?: boolean;
  /** Caller-provided popout handler — clicked from the docked header to
   *  detach the chat into a floating window. Hidden when isFloating. */
  onPopOut?: () => void;
}

export function ChatPanel({ isFloating = false, onPopOut }: ChatPanelProps = {}) {
  const [inputValue, setInputValue] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chatMessages = useEditorStore((s) => s.chatMessages);
  const isChatLoading = useEditorStore((s) => s.isChatLoading);
  const addChatMessage = useEditorStore((s) => s.addChatMessage);
  const updateChatMessage = useEditorStore((s) => s.updateChatMessage);
  const setChatLoading = useEditorStore((s) => s.setChatLoading);

  const provider = useSettingsStore((s) => s.provider);
  const model = useSettingsStore((s) => s.model);
  const getActiveApiKey = useSettingsStore((s) => s.getActiveApiKey);

  // ── Auto-follow scroll ──
  // Follow the bottom ONLY while the user is pinned there — scrolling up to
  // read pauses following until they return to the bottom. Scrolling is
  // coalesced through requestAnimationFrame so rapid streaming deltas move
  // the viewport once per frame instead of hard-snapping per token.
  const pinnedToBottomRef = useRef(true);
  const followRafRef = useRef(0);

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );
    if (!viewport) return;
    const onScroll = () => {
      pinnedToBottomRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const viewport = scrollRef.current?.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );
    if (!viewport) return;
    cancelAnimationFrame(followRafRef.current);
    followRafRef.current = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(followRafRef.current);
  }, [chatMessages]);

  // Auto-resize textarea up to a max height; scroll inside after that.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, 160); // ~6 lines
    ta.style.height = `${next}px`;
  }, [inputValue]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isChatLoading) return;

      const trimmed = message.trim();
      setInputValue("");

      // Add user message
      addChatMessage({ role: "user", content: trimmed });

      // Check for API key
      const apiKey = getActiveApiKey();
      if (!apiKey) {
        addChatMessage({
          role: "assistant",
          content: `No API key configured for ${provider}. Open settings to add one.`,
          isError: true,
        });
        return;
      }

      // Add loading placeholder
      const assistantMsgId = addChatMessage({
        role: "assistant",
        content: "",
        isLoading: true,
      });

      setChatLoading(true);

      // Build message history for the agent
      const history = chatMessages
        .filter((m) => !m.isLoading)
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: trimmed });

      // Track tool calls for this message
      const msgToolCalls: ToolCallInfo[] = [];

      const abortController = new AbortController();
      abortRef.current = abortController;

      let accumulatedText = "";

      try {
        await runAgentLoop(
          history,
          { provider, apiKey, model },
          (delta: StreamDelta) => {
            switch (delta.type) {
              case "text":
                accumulatedText += delta.content || "";
                updateChatMessage(assistantMsgId, {
                  content: accumulatedText,
                  isLoading: false,
                });
                break;

              case "tool_use_start":
                if (delta.toolName && delta.toolArgs) {
                  msgToolCalls.push({
                    toolName: delta.toolName,
                    args: delta.toolArgs,
                  });
                  updateChatMessage(assistantMsgId, {
                    toolCalls: [...msgToolCalls],
                  });
                }
                break;

              case "tool_result":
                if (delta.toolName && delta.toolResult) {
                  if (!delta.toolResult.success) {
                    showToast("error", `${delta.toolName}: ${delta.toolResult.error || "failed"}`);
                  }
                  const lastIdx = msgToolCalls.length - 1;
                  if (lastIdx >= 0 && msgToolCalls[lastIdx].toolName === delta.toolName) {
                    msgToolCalls[lastIdx].result = delta.toolResult;
                  } else {
                    // Fallback: find the matching tool call
                    for (let i = msgToolCalls.length - 1; i >= 0; i--) {
                      if (msgToolCalls[i].toolName === delta.toolName && !msgToolCalls[i].result) {
                        msgToolCalls[i].result = delta.toolResult;
                        break;
                      }
                    }
                  }
                  updateChatMessage(assistantMsgId, {
                    toolCalls: [...msgToolCalls],
                  });
                }
                break;

              case "error":
                updateChatMessage(assistantMsgId, {
                  content: accumulatedText || delta.content || "An error occurred.",
                  isLoading: false,
                  isError: true,
                });
                break;

              case "done":
                updateChatMessage(assistantMsgId, {
                  content: accumulatedText || "Done.",
                  isLoading: false,
                });
                break;
            }
          },
          abortController.signal
        );
      } catch (error) {
        updateChatMessage(assistantMsgId, {
          content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          isLoading: false,
          isError: true,
        });
      } finally {
        setChatLoading(false);
        abortRef.current = null;
      }
    },
    [
      isChatLoading,
      chatMessages,
      provider,
      model,
      getActiveApiKey,
      addChatMessage,
      updateChatMessage,
      setChatLoading,
    ]
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      sendMessage(inputValue);
    },
    [inputValue, sendMessage]
  );

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="flex flex-col h-full min-w-0 bg-neutral-900">
      {/* Header — hidden when floating (the wrapper provides its own bar) */}
      {!isFloating && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-neutral-200 truncate">ChatCut</h2>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-neutral-800 text-[11px] text-neutral-400 font-medium truncate shrink min-w-0">
              {model}
            </span>
            {onPopOut && (
              <button
                onClick={onPopOut}
                className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                title="Pop chat out into a floating window"
                aria-label="Pop chat out"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M15 3h6v6" />
                  <path d="M10 14L21 3" />
                  <path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 min-w-0" ref={scrollRef}>
        <div className="p-4 space-y-4 min-w-0">
          {chatMessages.length === 0 && <EmptyState />}

          {chatMessages.map((msg) => (
            <div key={msg.id} className="min-w-0 chat-message-in">
              <ChatMessage message={msg} />
              {/* Render tool call cards for assistant messages */}
              {msg.role === "assistant" &&
                msg.toolCalls?.map((tc, idx) => (
                  <ToolCallCard
                    key={`${msg.id}-tool-${idx}`}
                    toolName={tc.toolName}
                    args={tc.args}
                    result={tc.result}
                  />
                ))}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input — multi-line, auto-resizing. Enter sends; Shift+Enter newline. */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 p-3 border-t border-neutral-800 min-w-0"
      >
        <div className="flex-1 min-w-0 relative">
          <textarea
            ref={textareaRef}
            data-chat-input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Describe what to edit…  (Shift+Enter for newline)"
            disabled={isChatLoading}
            rows={1}
            className="w-full resize-none rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 disabled:opacity-60 leading-relaxed min-h-[36px] max-h-[160px] overflow-y-auto"
          />
        </div>
        {isChatLoading ? (
          <Button
            type="button"
            size="icon"
            onClick={handleAbort}
            className="h-9 w-9 bg-red-600 hover:bg-red-500 text-white shrink-0"
            title="Stop"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!inputValue.trim()}
            className="h-9 w-9 bg-blue-600 hover:bg-blue-500 text-white shrink-0"
            title="Send (Enter)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </Button>
        )}
      </form>
    </div>
  );
}
