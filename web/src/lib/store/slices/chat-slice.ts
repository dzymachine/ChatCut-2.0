/**
 * Chat slice — assistant conversation state.
 *
 * Owns: `chatMessages`, `isChatLoading`
 * Actions: addChatMessage, updateChatMessage, setChatLoading
 *
 * Cross-slice note: the project slice's initProject clears chatMessages.
 */

import type { StateCreator } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { EditorStore } from './types';

type ChatSlice = Pick<
  EditorStore,
  'chatMessages' | 'isChatLoading' | 'addChatMessage' | 'updateChatMessage' | 'setChatLoading'
>;

export const createChatSlice: StateCreator<EditorStore, [], [], ChatSlice> = (set) => ({
  // ── Initial State ──
  chatMessages: [],
  isChatLoading: false,

  // ── Chat Actions ──

  addChatMessage: (message) => {
    const id = uuid();
    const newMessage = { ...message, id, timestamp: Date.now() };
    set((state) => ({
      chatMessages: [...state.chatMessages, newMessage],
    }));
    return id;
  },

  updateChatMessage: (id, updates) => {
    set((state) => ({
      chatMessages: state.chatMessages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    }));
  },

  setChatLoading: (loading) => {
    set({ isChatLoading: loading });
  },
});
