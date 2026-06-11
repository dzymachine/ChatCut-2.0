/**
 * Playback slice — transport state (play/pause, time, volume, rate).
 *
 * Owns: `playback`
 * Actions: setPlaying, setCurrentTime, setVolume, toggleMute, setPlaybackRate
 *
 * Cross-slice note: the project slice's removeClip resets playback when the
 * timeline becomes empty. The VideoEngine render loop also writes currentTime.
 */

import type { StateCreator } from 'zustand';
import { getVideoEngine } from '@/lib/engine/video-engine';
import { DEFAULT_PLAYBACK } from '@/types/editor';
import type { EditorStore } from './types';

type PlaybackSlice = Pick<
  EditorStore,
  'playback' | 'setPlaying' | 'setCurrentTime' | 'setVolume' | 'toggleMute' | 'setPlaybackRate'
>;

export const createPlaybackSlice: StateCreator<EditorStore, [], [], PlaybackSlice> = (set, get) => ({
  // ── Initial State ──
  playback: { ...DEFAULT_PLAYBACK },

  // ── Playback Actions ──

  setPlaying: (playing) => {
    set((state) => ({
      playback: { ...state.playback, isPlaying: playing },
    }));
  },

  setCurrentTime: (time) => {
    set((state) => ({
      playback: { ...state.playback, currentTime: time },
    }));
  },

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    set((state) => ({
      playback: { ...state.playback, volume: clamped },
    }));
    // sync with video engine
    const engine = getVideoEngine();
    engine.setVolume(clamped);
    // if the user increases volume while muted, unmute
    const isMuted = get().playback.isMuted;
    if (clamped > 0 && isMuted) {
      get().toggleMute();
    }
  },

  toggleMute: () => {
    set((state) => {
      const newMuted = !state.playback.isMuted;
      // also update engine
      const engine = getVideoEngine();
      engine.setMuted(newMuted);
      return { playback: { ...state.playback, isMuted: newMuted } };
    });
  },

  setPlaybackRate: (rate) => {
    set((state) => ({
      playback: { ...state.playback, playbackRate: rate },
    }));
  },
});
