/**
 * Timeline-view slice — zoom, panel sizing, snapping, active tool.
 *
 * Owns: `timeline`
 * Actions: setTimelineZoom, setTimelinePanelHeight, setSnapEnabled, setActiveTool
 *
 * Cross-slice: none.
 */

import type { StateCreator } from 'zustand';
import { DEFAULT_TIMELINE_STATE } from '@/types/editor';
import type { EditorStore } from './types';

type TimelineViewSlice = Pick<
  EditorStore,
  'timeline' | 'setTimelineZoom' | 'setTimelinePanelHeight' | 'setSnapEnabled' | 'setActiveTool'
>;

export const createTimelineViewSlice: StateCreator<EditorStore, [], [], TimelineViewSlice> = (set) => ({
  // ── Initial State ──
  timeline: { ...DEFAULT_TIMELINE_STATE },

  // ── Timeline Actions ──

  setTimelineZoom: (pixelsPerSecond) => {
    set((state) => ({
      timeline: {
        ...state.timeline,
        pixelsPerSecond: Math.max(10, Math.min(600, pixelsPerSecond)),
      },
    }));
  },

  setTimelinePanelHeight: (height) => {
    set((state) => ({
      timeline: {
        ...state.timeline,
        panelHeight: Math.max(
          state.timeline.panelMinHeight,
          Math.min(height, (typeof window !== 'undefined' ? window.innerHeight : 900) * state.timeline.panelMaxHeightRatio)
        ),
      },
    }));
  },

  setSnapEnabled: (enabled) => {
    set((state) => ({
      timeline: { ...state.timeline, snapEnabled: enabled },
    }));
  },

  setActiveTool: (tool) => {
    set((state) => ({
      timeline: { ...state.timeline, activeTool: tool },
    }));
  },
});
