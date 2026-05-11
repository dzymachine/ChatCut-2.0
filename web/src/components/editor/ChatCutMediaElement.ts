"use client";

import { useEditorStore } from "@/lib/store/editor-store";
import { getVideoEngine } from "@/lib/engine/video-engine";

const TIMEUPDATE_INTERVAL_MS = 250;
/** Min |Δt| (seconds) before a paused-seek dispatches a timeupdate. */
const PAUSED_SEEK_EPSILON = 0.01;

function registerChatCutMediaElement() {
  if (typeof window === "undefined") return;
  if (customElements.get("chatcut-media")) return;

  class ChatCutMediaElement extends HTMLElement {
    private _unsubscribe: (() => void) | null = null;
    private _timeupdateTimer: ReturnType<typeof setInterval> | null = null;
    private _prevIsPlaying = false;
    private _prevVolume = 1;
    private _prevMuted = false;
    private _prevDuration = 0;
    private _prevCurrentTime = 0;

    get readyState(): number {
      return getVideoEngine().hasSourceLoaded() ? 4 : 0;
    }

    get paused(): boolean {
      return !useEditorStore.getState().playback.isPlaying;
    }

    get currentTime(): number {
      return useEditorStore.getState().playback.currentTime;
    }

    set currentTime(t: number) {
      getVideoEngine().seek(t);
    }

    get duration(): number {
      return useEditorStore.getState().project.composition.duration;
    }

    get volume(): number {
      return useEditorStore.getState().playback.volume;
    }

    set volume(v: number) {
      useEditorStore.getState().setVolume(v);
    }

    get muted(): boolean {
      return useEditorStore.getState().playback.isMuted;
    }

    set muted(m: boolean) {
      const current = useEditorStore.getState().playback.isMuted;
      if (m !== current) {
        useEditorStore.getState().toggleMute();
      }
    }

    get playbackRate(): number {
      return useEditorStore.getState().playback.playbackRate;
    }

    set playbackRate(r: number) {
      useEditorStore.getState().setPlaybackRate(r);
    }

    get ended(): boolean {
      const { currentTime } = useEditorStore.getState().playback;
      const { duration } = useEditorStore.getState().project.composition;
      return (
        currentTime >= duration &&
        !useEditorStore.getState().playback.isPlaying
      );
    }

    get seeking(): boolean {
      return false;
    }

    get networkState(): number {
      return 2;
    }

    get buffered(): TimeRanges {
      const dur = this.duration;
      return {
        length: dur > 0 ? 1 : 0,
        start: () => 0,
        end: () => dur,
      } as TimeRanges;
    }

    get seekable(): TimeRanges {
      return this.buffered;
    }

    play(): Promise<void> {
      getVideoEngine().play();
      return Promise.resolve();
    }

    pause(): void {
      getVideoEngine().pause();
    }

    connectedCallback(): void {
      this._startSync();
    }

    disconnectedCallback(): void {
      this._stopSync();
    }

    private _startSync(): void {
      const state = useEditorStore.getState();
      this._prevIsPlaying = state.playback.isPlaying;
      this._prevVolume = state.playback.volume;
      this._prevMuted = state.playback.isMuted;
      this._prevDuration = state.project.composition.duration;
      this._prevCurrentTime = state.playback.currentTime;

      this._unsubscribe = useEditorStore.subscribe((s) => {
        const pb = s.playback;

        if (pb.isPlaying !== this._prevIsPlaying) {
          this._prevIsPlaying = pb.isPlaying;
          this.dispatchEvent(new Event(pb.isPlaying ? "play" : "pause"));
          if (pb.isPlaying) {
            this.dispatchEvent(new Event("playing"));
            this._startTimeupdateTimer();
          } else {
            this._stopTimeupdateTimer();
          }
        }

        if (
          pb.volume !== this._prevVolume ||
          pb.isMuted !== this._prevMuted
        ) {
          this._prevVolume = pb.volume;
          this._prevMuted = pb.isMuted;
          this.dispatchEvent(new Event("volumechange"));
        }

        const dur = s.project.composition.duration;
        if (dur !== this._prevDuration) {
          this._prevDuration = dur;
          this.dispatchEvent(new Event("durationchange"));
          if (dur > 0) {
            this.dispatchEvent(new Event("loadedmetadata"));
          }
        }

        // Drive Media Chrome's scrubber/time display during seek-while-paused.
        // The interval timer only runs during playback, so paused seeks
        // (timeline click, scrubber drag) wouldn't otherwise propagate.
        if (
          !pb.isPlaying &&
          Math.abs(pb.currentTime - this._prevCurrentTime) > PAUSED_SEEK_EPSILON
        ) {
          this._prevCurrentTime = pb.currentTime;
          this.dispatchEvent(new Event("timeupdate"));
        }
      });

      if (this.duration > 0) {
        this.dispatchEvent(new Event("loadedmetadata"));
      }
    }

    private _stopSync(): void {
      this._unsubscribe?.();
      this._unsubscribe = null;
      this._stopTimeupdateTimer();
    }

    private _startTimeupdateTimer(): void {
      if (this._timeupdateTimer) return;
      this._timeupdateTimer = setInterval(() => {
        this._prevCurrentTime = useEditorStore.getState().playback.currentTime;
        this.dispatchEvent(new Event("timeupdate"));
      }, TIMEUPDATE_INTERVAL_MS);
    }

    private _stopTimeupdateTimer(): void {
      if (this._timeupdateTimer) {
        clearInterval(this._timeupdateTimer);
        this._timeupdateTimer = null;
      }
      this.dispatchEvent(new Event("timeupdate"));
    }
  }

  customElements.define("chatcut-media", ChatCutMediaElement);
}

registerChatCutMediaElement();

export {};
