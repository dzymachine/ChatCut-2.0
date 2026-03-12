"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@/hooks/useChat";
import { ChatMessage } from "./ChatMessage";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ChatPanel() {
  const {
    inputValue,
    setInputValue,
    chatMessages,
    isChatLoading,
    chatMode,
    setChatMode,
    isConnected,
    handleSubmit,
    checkConnection,
  } = useChat();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Check connection on mount
  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      // Find the viewport element inside ScrollArea
      const viewport = scrollRef.current.querySelector('[data-slot="scroll-area-viewport"]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [chatMessages]);

  return (
    <div className="flex flex-col h-full bg-neutral-900 border-l border-neutral-800">
      {/* Header */}
      <div className="grid grid-cols-3 items-center px-4 py-3 border-b border-neutral-800 gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-200">ChatCut</h2>
          <span className="text-xs text-neutral-500">AI Editor</span>
        </div>
        <div className="flex items-center justify-center">
          <label className="flex items-center text-xs text-neutral-400">
            <select
              value={chatMode}
              onChange={(e) => setChatMode(e.target.value as "effects" | "generation")}
              className="h-7 rounded-md border border-neutral-700 bg-neutral-800 px-2 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="effects">Effects</option>
              <option value="generation">Generate</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected === null
                ? "bg-neutral-600"
                : isConnected
                  ? "bg-emerald-500"
                  : "bg-red-500"
            }`}
          />
          <span className="text-xs text-neutral-500">
            {isConnected === null
              ? "Checking..."
              : isConnected
                ? "Connected"
                : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-4">
          {chatMessages.length === 0 && (
            <div className="text-center py-12">
              <div className="text-neutral-500 text-sm space-y-3">
                <p className="text-neutral-400 font-medium">
                  Welcome to ChatCut
                </p>
                <p>
                  {chatMode === "effects"
                    ? "Drop a video and try saying:"
                    : "Generation mode is available to switch to, but generation actions are not implemented yet."}
                </p>
                <div className="space-y-1.5">
                  {(chatMode === "effects"
                    ? [
                        '"Zoom in by 150%"',
                        '"Add a blur effect"',
                        '"Set brightness to 120%"',
                        '"Make it black and white"',
                        '"Rotate 15 degrees"',
                      ]
                    : ['"Generate a cinematic clip"', '"Create a stylized version"', '"Make an anime-style render"']
                  ).map((example) => (
                    <button
                      key={example}
                      onClick={() => {
                        setInputValue(example.replace(/"/g, ""));
                      }}
                      className="block w-full text-left px-3 py-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors text-xs"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {chatMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 p-3 border-t border-neutral-800"
      >
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={
            isConnected === false
              ? "Backend not connected..."
              : chatMode === "effects"
                ? "Describe an effect edit..."
                : "Describe what to generate..."
          }
          disabled={isChatLoading || isConnected === false}
          className="flex-1 bg-neutral-800 border-neutral-700 text-neutral-200 placeholder:text-neutral-500 focus-visible:ring-blue-500/50 text-sm"
        />
        <Button
          type="submit"
          size="icon"
          disabled={isChatLoading || !inputValue.trim() || isConnected === false}
          className="h-9 w-9 bg-blue-600 hover:bg-blue-500 text-white shrink-0"
        >
          {isChatLoading ? (
            <svg
              className="animate-spin h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                className="opacity-25"
              />
              <path
                d="M4 12a8 8 0 018-8"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="opacity-75"
              />
            </svg>
          ) : (
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
          )}
        </Button>
      </form>
    </div>
  );
}
