"use client";

/**
 * React hook for the chat interface.
 * Handles sending messages to the AI backend, receiving actions,
 * and executing them through the command handler.
 */

import { useState, useCallback } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { processPrompt, checkBackendHealth } from "@/lib/ai/client";
import { mapAIActions } from "@/lib/ai/action-mapper";
import { executeActions } from "@/lib/commands/command-handler";

export function useChat() {
  const [inputValue, setInputValue] = useState("");
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  const {
    chatMessages,
    isChatLoading,
    addChatMessage,
    updateChatMessage,
    setChatLoading,
  } = useEditorStore();

  // Check backend connection
  const checkConnection = useCallback(async () => {
    const healthy = await checkBackendHealth();
    setIsConnected(healthy);
    return healthy;
  }, []);

  // Send a message
  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isChatLoading) return;

      const trimmed = message.trim();
      setInputValue("");

      // Add user message
      addChatMessage({ role: "user", content: trimmed });

      // Add a loading placeholder for the assistant response
      const assistantMsgId = addChatMessage({
        role: "assistant",
        content: "",
        isLoading: true,
      });

      setChatLoading(true);

      try {
        // Build context from current state
        const store = useEditorStore.getState();
        const activeClip = store.getActiveClip();
        const context = {
          hasClip: activeClip !== null,
          clipDuration: store.getDuration(),
          currentTransform: activeClip
            ? {
                scale: activeClip.transform.scale,
                positionX: activeClip.transform.positionX,
                positionY: activeClip.transform.positionY,
                rotation: activeClip.transform.rotation,
                opacity: activeClip.transform.opacity,
                ...activeClip.transform.filters,
              }
            : undefined,
        };

        // Send to backend
        const response = await processPrompt(trimmed, context);

        if (response.error) {
          updateChatMessage(assistantMsgId, {
            content: response.error,
            isLoading: false,
            isError: true,
          });
          return;
        }

        // Map and execute actions
        let resultMessage = response.response;

        if (response.actions && response.actions.length > 0) {
          const editActions = mapAIActions(response.actions);

          if (editActions.length > 0) {
            const results = executeActions(editActions);

            // Build a summary of what was done
            const successActions = results.filter((r) => r.success);
            const failedActions = results.filter((r) => !r.success);

            if (successActions.length > 0) {
              const actionSummary = successActions.map((r) => r.message).join(". ");
              resultMessage = resultMessage
                ? `${resultMessage}\n\n✓ ${actionSummary}`
                : `✓ ${actionSummary}`;
            }

            if (failedActions.length > 0) {
              const failSummary = failedActions.map((r) => r.message).join(". ");
              resultMessage = resultMessage
                ? `${resultMessage}\n\n⚠ ${failSummary}`
                : `⚠ ${failSummary}`;
            }
          }
        }

        updateChatMessage(assistantMsgId, {
          content: resultMessage || "Done!",
          isLoading: false,
          actions: response.actions
            ? mapAIActions(response.actions)
            : undefined,
        });
      } catch (error) {
        updateChatMessage(assistantMsgId, {
          content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          isLoading: false,
          isError: true,
        });
      } finally {
        setChatLoading(false);
      }
    },
    [isChatLoading, addChatMessage, updateChatMessage, setChatLoading]
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      sendMessage(inputValue);
    },
    [inputValue, sendMessage]
  );

  return {
    inputValue,
    setInputValue,
    chatMessages,
    isChatLoading,
    isConnected,
    sendMessage,
    handleSubmit,
    checkConnection,
  };
}
