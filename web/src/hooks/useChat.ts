"use client";

/**
 * React hook for the chat interface.
 * Handles sending messages to the AI backend, receiving actions,
 * and executing them through the command handler.
 */

import { useState, useCallback } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { processPrompt, checkBackendHealth, processMedia } from "@/lib/ai/client";
import { mapAIActions } from "@/lib/ai/action-mapper";
import { executeActions } from "@/lib/commands/command-handler";

export function useChat() {
  const [inputValue, setInputValue] = useState("");
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  const {
    chatMessages,
    isChatLoading,
    chatMode,
    addChatMessage,
    updateChatMessage,
    setChatLoading,
    setChatMode,
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

      // Generation mode
      if (chatMode === "generation") {
        const store = useEditorStore.getState();
        const activeClip = store.getActiveClip();

        if (!activeClip) {
          addChatMessage({
            role: "assistant",
            content: "Please select a video clip on the timeline first.",
          });
          return;
        }

        const mediaFile = store.mediaFiles.get(activeClip.sourceFileId);
        // The backend needs a physical file path to upload to Runway ML.
        const filePath = mediaFile?.nativePath;

        if (!filePath) {
          addChatMessage({
            role: "assistant",
            content: "Cannot process this file. Please make sure you are using the Desktop app (Tauri) to grant local file access.",
          });
          return;
        }

        const assistantMsgId = addChatMessage({
          role: "assistant",
          content: "Generating new clip with Runway ML... this may take a minute.",
          isLoading: true,
        });

        setChatLoading(true);

        try {
          const result = await processMedia(filePath, trimmed);

          if (result.error) {
            updateChatMessage(assistantMsgId, {
              content: result.error,
              isLoading: false,
              isError: true,
            });
            return;
          }

          if (result.output_path) {
            // Load the newly generated file into the project
            const newMediaFile = await store.addMediaFileFromPath(result.output_path, "AI_Generated.mp4");
            
            // Swap out the timeline clip to use the new media source
            store.replaceClipMedia(activeClip.id, newMediaFile);

            updateChatMessage(assistantMsgId, {
              content: "✓ Successfully generated and replaced the clip on the timeline.",
              isLoading: false,
            });
          } else {
            updateChatMessage(assistantMsgId, {
              content: "Failed to generate video: no output path returned from backend.",
              isLoading: false,
              isError: true,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error 
            ? error.message 
            : typeof error === 'string' 
              ? error 
              : "Unknown error";
              
          updateChatMessage(assistantMsgId, {
            content: `Error: ${errorMessage}`,
            isLoading: false,
            isError: true,
          });
        } finally {
          setChatLoading(false);
        }

        return;
      }

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
        const errorMessage = error instanceof Error 
          ? error.message 
          : typeof error === 'string' 
            ? error 
            : "Unknown error";
            
        updateChatMessage(assistantMsgId, {
          content: `Error: ${errorMessage}`,
          isLoading: false,
          isError: true,
        });
      } finally {
        setChatLoading(false);
      }
    },
    [chatMode, isChatLoading, addChatMessage, updateChatMessage, setChatLoading]
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
    chatMode,
    setChatMode,
    isConnected,
    sendMessage,
    handleSubmit,
    checkConnection,
  };
}
