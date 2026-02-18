/**
 * ChatCut — Video Engine
 *
 * The rendering core of the editor. Manages a <video> element and draws each
 * frame to a <canvas> with transforms applied.
 *
 * CRITICAL DESIGN DECISIONS:
 *  1. This class does NOT use React. It reads from the Zustand store directly
 *     via getState() so that React re-renders never cause frame drops.
 *  2. The render loop runs at display refresh rate (requestAnimationFrame).
 *  3. The engine is responsible for syncing playback state back to the store
 *     (current time updates, duration, play/pause state).
 *  4. All visual transforms (zoom, position, rotation, opacity, filters) are
 *     applied during rendering — the source video is never modified.
 */

import { useEditorStore, type EditorStore } from '@/lib/store/editor-store';
import type { Transform, FilterState, Clip } from '@/types/editor';

export class VideoEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private isInitialized = false;

  // Timing
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;

  // Brief suppression window after a programmatic seek to prevent the
  // render loop from overwriting the store with a stale videoElement.currentTime.
  // More reliable than checking videoElement.seeking (stuck in WKWebView).
  private timeSyncSuppressedUntil = 0;

  // Store reference for direct reads
  private getState: () => EditorStore;

  // Animation state for animated transforms
  private animations: Map<string, TransformAnimation> = new Map();

  constructor() {
    this.getState = useEditorStore.getState;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize the engine with a canvas element.
   * Creates a hidden <video> element for media playback.
   *
   * The video element is attached to the DOM (visually hidden) because
   * macOS WKWebView (Tauri) does not fire timeupdate events or advance
   * playback on fully detached video elements.
   */
  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;

    // Create a hidden-but-attached video element
    this.videoElement = document.createElement('video');
    this.videoElement.playsInline = true;
    this.videoElement.preload = 'auto';
    this.videoElement.style.position = 'fixed';
    this.videoElement.style.top = '-9999px';
    this.videoElement.style.left = '-9999px';
    this.videoElement.style.width = '1px';
    this.videoElement.style.height = '1px';
    this.videoElement.style.opacity = '0';
    this.videoElement.style.pointerEvents = 'none';
    document.body.appendChild(this.videoElement);

    // Sync video events back to the store
    this.videoElement.addEventListener('timeupdate', this.onTimeUpdate);
    this.videoElement.addEventListener('ended', this.onEnded);
    this.videoElement.addEventListener('play', () => this.getState().setPlaying(true));
    this.videoElement.addEventListener('pause', () => this.getState().setPlaying(false));

    this.isInitialized = true;
    this.startRenderLoop();
  }

  /**
   * Destroy the engine and clean up resources.
   */
  destroy(): void {
    this.stopRenderLoop();

    if (this.videoElement) {
      this.videoElement.removeEventListener('timeupdate', this.onTimeUpdate);
      this.videoElement.removeEventListener('ended', this.onEnded);
      this.videoElement.pause();
      this.videoElement.src = '';
      // Remove from DOM
      if (this.videoElement.parentNode) {
        this.videoElement.parentNode.removeChild(this.videoElement);
      }
      this.videoElement = null;
    }

    this.canvas = null;
    this.ctx = null;
    this.isInitialized = false;
  }

  // ─── Media Loading ────────────────────────────────────────────────────

  /**
   * Unload any media source — stops playback, clears the video element,
   * and resets the canvas to the placeholder.  Call this when all clips
   * are removed so the engine is fully idle.
   */
  unloadSource(): void {
    if (!this.videoElement) return;

    this.videoElement.pause();
    this.videoElement.removeAttribute('src');
    this.videoElement.load(); // resets the media element

    // Reset playback state in the store
    const state = this.getState();
    state.setPlaying(false);
    state.setCurrentTime(0);

    // Immediately redraw the placeholder
    if (this.canvas && this.ctx) {
      this.drawPlaceholder();
    }
  }

  /**
   * Load a media source into the video element.
   */
  loadSource(blobUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.videoElement) {
        reject(new Error('Engine not initialized'));
        return;
      }

      const video = this.videoElement;

      // Clean up any previous source
      video.pause();
      video.removeAttribute('src');
      video.load();

      const onLoaded = () => {
        cleanup();
        this.resizeCanvas();
        resolve();
      };

      const onError = () => {
        cleanup();
        const mediaError = video.error;
        const code = mediaError?.code;
        const messages: Record<number, string> = {
          1: 'Video loading was aborted',
          2: 'Network error while loading video',
          3: 'Video decoding failed — format may not be supported in this browser',
          4: 'Video format not supported',
        };
        reject(new Error(messages[code ?? 0] ?? 'Failed to load video'));
      };

      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
      };

      video.addEventListener('loadeddata', onLoaded);
      video.addEventListener('error', onError);
      video.src = blobUrl;
    });
  }

  /**
   * Resize the canvas to match the composition dimensions,
   * while fitting within the container.
   */
  resizeCanvas(): void {
    if (!this.canvas || !this.videoElement) return;

    const state = this.getState();
    const { width, height } = state.project.composition;

    // Set the canvas internal resolution to match composition
    this.canvas.width = width;
    this.canvas.height = height;
  }

  // ─── Playback Control ─────────────────────────────────────────────────

  play(): void {
    if (!this.videoElement) return;
    // Premiere Pro behavior: play is a no-op when the timeline is empty.
    const hasClips = this.getState().project.tracks.some(
      (t) => t.clips.length > 0
    );
    if (!hasClips) return;

    // Sync the video element to the store's playhead position before
    // starting playback. The store is the source of truth — scrubbing
    // updates the store but not the video element, so they can diverge.
    const storeTime = this.getState().playback.currentTime;
    const videoDur = this.videoElement.duration || 0;
    if (videoDur > 0) {
      this.videoElement.currentTime = Math.min(storeTime, videoDur);
      // Suppress render-loop time sync briefly so the stale pre-seek
      // value doesn't flash the playhead back to the old position.
      this.timeSyncSuppressedUntil = performance.now() + 150;
    }

    this.videoElement.play().catch(console.error);
  }

  pause(): void {
    if (!this.videoElement) return;
    this.videoElement.pause();
  }

  togglePlayback(): void {
    if (!this.videoElement) return;
    if (this.videoElement.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  seek(time: number): void {
    if (!this.videoElement) return;
    const safeTime = Math.max(0, time);

    // Update the store first — the store is the source of truth for
    // the playhead position and is NOT clamped to the video's duration.
    this.getState().setCurrentTime(safeTime);

    // Seek the video element (clamped to its actual duration so it
    // doesn't throw). This positions the video for the canvas render.
    const videoDur = this.videoElement.duration || 0;
    if (videoDur > 0) {
      this.videoElement.currentTime = Math.min(safeTime, videoDur);
    }
  }

  setVolume(volume: number): void {
    if (!this.videoElement) return;
    this.videoElement.volume = Math.max(0, Math.min(1, volume));
  }

  setMuted(muted: boolean): void {
    if (!this.videoElement) return;
    this.videoElement.muted = muted;
  }

  setPlaybackRate(rate: number): void {
    if (!this.videoElement) return;
    this.videoElement.playbackRate = rate;
  }

  getDuration(): number {
    return this.videoElement?.duration || 0;
  }

  getCurrentTime(): number {
    return this.videoElement?.currentTime || 0;
  }

  // ─── Animated Transforms ────────────────────────────────────────────

  /**
   * Animate a transform property over a duration.
   */
  animateTransform(
    clipId: string,
    property: keyof Transform | `filters.${keyof FilterState}`,
    targetValue: number,
    duration: number,
    easing: EasingFunction = 'easeInOut'
  ): void {
    const clip = this.getState().getClipById(clipId);
    if (!clip) return;

    // Get current value
    let startValue: number;
    if (property.startsWith('filters.')) {
      const filterKey = property.split('.')[1] as keyof FilterState;
      startValue = clip.transform.filters[filterKey];
    } else {
      startValue = clip.transform[property as keyof Transform] as number;
    }

    const animation: TransformAnimation = {
      clipId,
      property,
      startValue,
      targetValue,
      startTime: performance.now(),
      duration: duration * 1000, // convert to ms
      easing,
    };

    this.animations.set(`${clipId}:${property}`, animation);
  }

  // ─── Render Loop ──────────────────────────────────────────────────────

  private startRenderLoop(): void {
    if (this.animationFrameId !== null) return;
    this.lastFrameTime = performance.now();
    this.renderLoop(this.lastFrameTime);
  }

  private stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private renderLoop = (now: number): void => {
    this.animationFrameId = requestAnimationFrame(this.renderLoop);

    // FPS tracking
    this.frameCount++;
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }

    // Sync playback time at full frame rate (60 fps) for smooth playhead.
    // The native "timeupdate" event only fires ~4 times/sec, causing jitter.
    // Skip during the brief suppression window after a programmatic seek
    // so the stale pre-seek currentTime doesn't flash the playhead back.
    if (
      this.videoElement &&
      !this.videoElement.paused &&
      this.videoElement.readyState >= 2 &&
      now > this.timeSyncSuppressedUntil
    ) {
      this.getState().setCurrentTime(this.videoElement.currentTime);
    }

    // Process animations
    this.processAnimations(now);

    // Render the frame
    this.renderFrame();
  };

  private processAnimations(now: number): void {
    const completed: string[] = [];

    for (const [key, anim] of this.animations) {
      const elapsed = now - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);
      const easedProgress = applyEasing(progress, anim.easing);

      const currentValue = anim.startValue + (anim.targetValue - anim.startValue) * easedProgress;

      // Apply the animated value to the store
      if (anim.property.startsWith('filters.')) {
        const filterKey = anim.property.split('.')[1] as keyof FilterState;
        this.getState().updateFilter(anim.clipId, filterKey, currentValue);
      } else {
        this.getState().updateTransform(anim.clipId, {
          [anim.property]: currentValue,
        });
      }

      if (progress >= 1) {
        completed.push(key);
      }
    }

    // Clean up completed animations
    for (const key of completed) {
      this.animations.delete(key);
    }
  }

  private renderFrame(): void {
    if (!this.canvas || !this.ctx || !this.videoElement) return;
    if (this.videoElement.readyState < 2) return; // not enough data

    const { canvas, ctx, videoElement } = this;
    const state = this.getState();
    const clip = state.getActiveClip();

    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!clip) {
      // No clip loaded — draw placeholder
      this.drawPlaceholder();
      return;
    }

    // ── Gap check (Premiere-style) ──
    // If the playhead is beyond the clip's timeline range, show black.
    const currentTime = state.playback.currentTime;
    const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
    if (currentTime < clip.timelineStart || currentTime >= clipEnd) {
      // Playhead is in a gap — keep the black canvas (already cleared above)
      return;
    }

    const { transform } = clip;

    ctx.save();

    // 1. Apply opacity
    ctx.globalAlpha = transform.opacity;

    // 2. Apply CSS filters
    ctx.filter = buildCSSFilter(transform.filters);

    // 3. Move origin to center of canvas + position offset
    ctx.translate(
      canvas.width / 2 + transform.positionX,
      canvas.height / 2 + transform.positionY
    );

    // 4. Apply rotation
    if (transform.rotation !== 0) {
      ctx.rotate((transform.rotation * Math.PI) / 180);
    }

    // 5. Apply scale
    ctx.scale(transform.scale, transform.scale);

    // 6. Draw video centered on the origin
    // Calculate how to fit the video into the composition
    const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
    const canvasAspect = canvas.width / canvas.height;

    let drawWidth: number, drawHeight: number;
    if (videoAspect > canvasAspect) {
      // Video is wider than canvas — fit by width
      drawWidth = canvas.width;
      drawHeight = canvas.width / videoAspect;
    } else {
      // Video is taller than canvas — fit by height
      drawHeight = canvas.height;
      drawWidth = canvas.height * videoAspect;
    }

    ctx.drawImage(
      videoElement,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight
    );

    ctx.restore();
  }

  private drawPlaceholder(): void {
    if (!this.canvas || !this.ctx) return;
    const { canvas, ctx } = this;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#666666';
    ctx.font = '24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Drop a video to get started', canvas.width / 2, canvas.height / 2);
  }

  // ─── Event Handlers ───────────────────────────────────────────────────

  private onTimeUpdate = (): void => {
    // Time sync is handled in renderLoop at 60 fps for smooth playhead
    // movement. This handler is intentionally a no-op.
  };

  private onEnded = (): void => {
    const state = this.getState();
    if (state.playback.loop) {
      this.seek(0);
      this.play();
    } else {
      state.setPlaying(false);
    }
  };

  // ─── Public Getters ───────────────────────────────────────────────────

  getFPS(): number {
    return this.fps;
  }

  isReady(): boolean {
    return this.isInitialized && this.videoElement !== null && this.videoElement.readyState >= 2;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }
}

// ─── CSS Filter Builder ─────────────────────────────────────────────────────

function buildCSSFilter(filters: FilterState): string {
  const parts: string[] = [];

  if (filters.blur > 0) parts.push(`blur(${filters.blur}px)`);
  if (filters.brightness !== 1) parts.push(`brightness(${filters.brightness})`);
  if (filters.contrast !== 1) parts.push(`contrast(${filters.contrast})`);
  if (filters.saturate !== 1) parts.push(`saturate(${filters.saturate})`);
  if (filters.grayscale > 0) parts.push(`grayscale(${filters.grayscale})`);
  if (filters.sepia > 0) parts.push(`sepia(${filters.sepia})`);
  if (filters.hueRotate !== 0) parts.push(`hue-rotate(${filters.hueRotate}deg)`);

  return parts.length > 0 ? parts.join(' ') : 'none';
}

// ─── Easing Functions ───────────────────────────────────────────────────────

type EasingFunction = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

interface TransformAnimation {
  clipId: string;
  property: keyof Transform | `filters.${keyof FilterState}`;
  startValue: number;
  targetValue: number;
  startTime: number;
  duration: number; // ms
  easing: EasingFunction;
}

function applyEasing(t: number, easing: EasingFunction): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default:
      return t;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────
// The engine is a singleton. There is one canvas, one video, one render loop.

let engineInstance: VideoEngine | null = null;

export function getVideoEngine(): VideoEngine {
  if (!engineInstance) {
    engineInstance = new VideoEngine();
  }
  return engineInstance;
}

export function destroyVideoEngine(): void {
  if (engineInstance) {
    engineInstance.destroy();
    engineInstance = null;
  }
}
