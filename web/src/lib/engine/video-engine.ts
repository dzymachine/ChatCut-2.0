/**
 * ChatCut — Video Engine
 *
 * The rendering core of the editor. Manages a <video> element and draws each
 * frame to a <canvas> with transforms applied.
 *
 * ──── LAYERED ARCHITECTURE ────
 *
 * The editor is organized into independent layers to prevent changes in one
 * area from breaking another:
 *
 *   Layer 1 — TYPES (editor.ts)
 *     Pure data shapes. No logic, no side effects.
 *
 *   Layer 2 — STORE (editor-store.ts)
 *     Single source of truth for all state. Divided into independent slices:
 *       • Playback slice:  isPlaying, currentTime, volume, etc.
 *       • Timeline slice:  zoom, snap, active tool
 *       • Project slice:   tracks, clips, composition, linking
 *       • UI slice:        selection, panels
 *     Each slice's actions only modify their own slice, except clearly
 *     documented cross-slice interactions (e.g. removeClip resets playback
 *     when the timeline becomes empty).
 *
 *   Layer 3 — ENGINE (this file)
 *     Reads from the store via getState(). Writes ONLY to the playback slice
 *     (currentTime, isPlaying). Never modifies clips, tracks, or UI state.
 *     The engine is a CONSUMER of clip/timeline state and a PRODUCER of
 *     playback timing only.
 *
 *   Layer 4 — HOOKS (useVideoEngine.ts)
 *     React glue. Manages engine lifecycle, auto-reloads sources after
 *     HMR, and exposes stable callbacks for components.
 *
 *   Layer 5 — COMPONENTS (Timeline, VideoPreview, TransportControls)
 *     Pure UI. Subscribe to store slices via selectors. Never touch the
 *     engine directly — always go through the hook.
 *
 * KEY RULES:
 *  1. This class does NOT use React. Reads from Zustand via getState().
 *  2. The render loop runs at display refresh rate (rAF).
 *  3. Playback state (isPlaying) is decoupled from video element state:
 *     the timeline can be "playing" even if the video element is paused
 *     (gap playback via wall-clock).
 *  4. The singleton survives HMR via globalThis storage.
 *  5. play() is non-fatal: if the video element can't play, wall-clock
 *     fallback keeps the playhead moving.
 */

import { useEditorStore, type EditorStore } from '@/lib/store/editor-store';
import type { Transform, FilterState, Clip, Track } from '@/types/editor';
import { effectsToTransformAtTime, hasAnyKeyframes } from '@/lib/effects/keyframe-transform';

/**
 * Manages a pool of <video> elements — one per concurrently-visible source file.
 * Video elements are muted; audio is mixed separately via the store's playback state.
 */
class VideoElementPool {
  private elements = new Map<string, HTMLVideoElement>();
  private loadedSources = new Map<string, string>();

  getOrCreate(sourceFileId: string, url: string): HTMLVideoElement {
    const existing = this.elements.get(sourceFileId);
    if (existing) {
      if (this.loadedSources.get(sourceFileId) !== url) {
        existing.src = url;
        this.loadedSources.set(sourceFileId, url);
      }
      return existing;
    }

    const el = document.createElement('video');
    el.playsInline = true;
    el.preload = 'auto';
    el.muted = false;
    el.style.position = 'fixed';
    el.style.top = '-9999px';
    el.style.left = '-9999px';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    el.src = url;

    this.elements.set(sourceFileId, el);
    this.loadedSources.set(sourceFileId, url);
    return el;
  }

  get(sourceFileId: string): HTMLVideoElement | undefined {
    return this.elements.get(sourceFileId);
  }

  has(sourceFileId: string): boolean {
    return this.elements.has(sourceFileId);
  }

  pauseAll(): void {
    for (const el of this.elements.values()) {
      if (!el.paused) el.pause();
    }
  }

  destroyAll(): void {
    for (const el of this.elements.values()) {
      el.pause();
      el.src = '';
      el.parentNode?.removeChild(el);
    }
    this.elements.clear();
    this.loadedSources.clear();
  }

  /** Returns the first video element that has a loaded source (for backward compat). */
  getAnyLoaded(): HTMLVideoElement | null {
    for (const el of this.elements.values()) {
      if (el.readyState >= 2) return el;
    }
    return null;
  }

  getAll(): Map<string, HTMLVideoElement> {
    return this.elements;
  }
}

/** Describes an active clip at a specific time with its associated track. */
interface ActiveClip {
  clip: Clip;
  track: Track;
  videoElement: HTMLVideoElement | null;
}

export class VideoEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private isInitialized = false;

  /** Pool of video elements — one per source file. */
  private videoPool = new VideoElementPool();

  /**
   * Legacy single-video reference. Kept for backward compatibility with
   * loadSource/unloadSource and the hook's auto-reload logic.
   * Points to the "primary" video element (the first source loaded).
   */
  private videoElement: HTMLVideoElement | null = null;

  // Timing
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;

  // Brief suppression window after a programmatic seek
  private timeSyncSuppressedUntil = 0;

  // Wall-clock time tracking for advancing playhead during gaps
  private playStartWallTime: number | null = null;

  // Store reference for direct reads — refreshed via refreshStoreRef() to
  // stay current after HMR re-evaluates the store module.
  private getState: () => EditorStore;

  // Animation state for animated transforms
  private animations: Map<string, TransformAnimation> = new Map();

  constructor() {
    this.getState = useEditorStore.getState;
  }

  /**
   * Update the engine's store accessor to point to the current Zustand store.
   * Called by the useVideoEngine hook on every mount to ensure the engine
   * doesn't hold a stale reference after HMR re-evaluates the store module.
   */
  refreshStoreRef(accessor: () => EditorStore): void {
    this.getState = accessor;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize the engine with a canvas element.
   *
   * IDEMPOTENT: Safe to call multiple times (e.g. after HMR). If the engine
   * is already initialized, only the canvas reference is updated — the video
   * element and its loaded source are preserved. This prevents the "play
   * breaks after code edit" problem.
   *
   * The video element is attached to the DOM (visually hidden) because
   * macOS WKWebView (Tauri) does not fire timeupdate events or advance
   * playback on fully detached video elements.
   */
  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;

    // If already initialized (e.g. after HMR re-mount), keep the existing
    // video pool and its loaded sources — just restart the render loop.
    if (this.isInitialized) {
      this.startRenderLoop();
      return;
    }

    this.isInitialized = true;
    this.startRenderLoop();
  }

  /**
   * Destroy the engine and clean up resources.
   */
  destroy(): void {
    this.stopRenderLoop();
    this.videoPool.destroyAll();
    this.videoElement = null;
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
    this.videoPool.destroyAll();
    this.videoElement = null;

    const state = this.getState();
    state.setPlaying(false);
    state.setCurrentTime(0);

    if (this.canvas && this.ctx) {
      this.drawPlaceholder();
    }
  }

  /**
   * Load a media source. Creates a video element in the pool for this source.
   * The first loaded source becomes the "primary" video element for backward compat.
   *
   * After loading, explicitly seeks to time 0 and triggers a canvas redraw so
   * the user immediately sees the first frame of the video.
   */
  loadSource(blobUrl: string, sourceFileId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error('Engine not initialized'));
        return;
      }

      let fileId = sourceFileId;
      if (!fileId) {
        const state = this.getState();
        for (const [id, mf] of state.mediaFiles) {
          if (mf.previewUrl === blobUrl) {
            fileId = id;
            break;
          }
        }
        if (!fileId) fileId = `source_${Date.now()}`;
      }

      const video = this.videoPool.getOrCreate(fileId, blobUrl);

      if (!this.videoElement) {
        this.videoElement = video;
      }

      const finishLoad = () => {
        this.resizeCanvas();
        video.currentTime = 0;
        this.renderFrame();
      };

      if (video.readyState >= 2) {
        finishLoad();
        resolve();
        return;
      }

      const LOAD_TIMEOUT_MS = 15000;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Video loading timed out'));
      }, LOAD_TIMEOUT_MS);

      const onLoaded = () => {
        clearTimeout(timer);
        cleanup();
        finishLoad();
        resolve();
      };

      const onError = () => {
        clearTimeout(timer);
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
    });
  }

  /**
   * Resize the canvas to match the composition dimensions,
   * while fitting within the container.
   */
  resizeCanvas(): void {
    if (!this.canvas) return;

    const state = this.getState();
    const { width, height } = state.project.composition;

    this.canvas.width = width;
    this.canvas.height = height;
  }

  // ─── Playback Control ─────────────────────────────────────────────────

  /**
   * Maps timeline playhead time to source media time for a given clip.
   * Formula: sourceTime = clip.sourceStart + (timelineTime - clip.timelineStart)
   */
  private mapTimelineToSourceTime(clip: Clip, timelineTime: number): number {
    return clip.sourceStart + (timelineTime - clip.timelineStart);
  }

  /**
   * Finds all active video clips at the given timeline time, ordered from
   * bottom layer (V1, drawn first) to top layer (V3, drawn last / foreground).
   *
   * The track array is ordered [V3, V2, V1, A1, A2, A3] in the store,
   * so we reverse the video tracks for compositing order.
   */
  private getActiveVideoClips(timelineTime: number): ActiveClip[] {
    const state = this.getState();
    const result: ActiveClip[] = [];

    // Collect all video tracks that have an active clip at this time
    const videoTracks = state.project.tracks.filter(
      (t) => t.type === 'video' && t.visible && !t.muted
    );

    // Reverse so V1 (last in array) is drawn first (background)
    for (let i = videoTracks.length - 1; i >= 0; i--) {
      const track = videoTracks[i];
      for (const clip of track.clips) {
        const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
        if (timelineTime >= clip.timelineStart && timelineTime < clipEnd) {
          const mediaFile = state.mediaFiles.get(clip.sourceFileId);
          let videoEl: HTMLVideoElement | null = null;
          if (mediaFile) {
            videoEl = this.videoPool.getOrCreate(clip.sourceFileId, mediaFile.previewUrl);
          }
          result.push({ clip, track, videoElement: videoEl });
          // Allow multiple clips per track - if they overlap, the last one wins
        }
      }
    }

    return result;
  }

  /**
   * Ensures video pool elements exist for all sources in the project.
   * Called lazily when needed.
   */
  private ensurePoolForAllSources(): void {
    const state = this.getState();
    for (const track of state.project.tracks) {
      if (track.type !== 'video') continue;
      for (const clip of track.clips) {
        const mediaFile = state.mediaFiles.get(clip.sourceFileId);
        if (mediaFile && !this.videoPool.has(clip.sourceFileId)) {
          const el = this.videoPool.getOrCreate(clip.sourceFileId, mediaFile.previewUrl);
          if (!this.videoElement) {
            this.videoElement = el;
          }
        }
      }
    }
  }

  play(): void {
    const state = this.getState();
    const hasClips = state.project.tracks.some((t) => t.clips.length > 0);
    if (!hasClips) return;

    this.ensurePoolForAllSources();

    const timelineTime = state.playback.currentTime;

    // Set playback state FIRST — this is the source of truth.
    state.setPlaying(true);
    this.playStartWallTime = performance.now();

    // Start playback on all active video clips
    const activeClips = this.getActiveVideoClips(timelineTime);
    const isMuted = state.playback.isMuted;
    const volume = state.playback.volume;

    for (const { clip, videoElement } of activeClips) {
      if (!videoElement) continue;
      const sourceTime = this.mapTimelineToSourceTime(clip, timelineTime);
      const videoDur = videoElement.duration || 0;
      if (videoDur > 0) {
        videoElement.currentTime = Math.min(Math.max(sourceTime, 0), videoDur);
      }
      videoElement.muted = isMuted;
      videoElement.volume = volume;
      videoElement.play().catch((err) => {
        console.warn('[VideoEngine] play() rejected (wall-clock fallback active):', err.message);
      });
    }
    this.timeSyncSuppressedUntil = performance.now() + 150;
  }

  pause(): void {
    this.videoPool.pauseAll();
    this.playStartWallTime = null;
    this.getState().setPlaying(false);
  }

  togglePlayback(): void {
    const state = this.getState();
    if (state.playback.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  seek(time: number): void {
    const safeTime = Math.max(0, time);
    const state = this.getState();
    state.setCurrentTime(safeTime);

    this.ensurePoolForAllSources();

    const activeClips = this.getActiveVideoClips(safeTime);
    for (const { clip, videoElement } of activeClips) {
      if (!videoElement) continue;
      const sourceTime = this.mapTimelineToSourceTime(clip, safeTime);
      const videoDur = videoElement.duration || 0;
      if (videoDur > 0) {
        videoElement.currentTime = Math.min(Math.max(sourceTime, 0), videoDur);
      }
    }
    this.timeSyncSuppressedUntil = performance.now() + 150;

    this.renderFrame();
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    for (const el of this.videoPool.getAll().values()) {
      el.volume = clamped;
    }
  }

  setMuted(muted: boolean): void {
    for (const el of this.videoPool.getAll().values()) {
      el.muted = muted;
    }
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

    const state = this.getState();

    if (state.playback.isPlaying && now > this.timeSyncSuppressedUntil) {
      const timelineTime = state.playback.currentTime;
      const activeClips = this.getActiveVideoClips(timelineTime);

      // Find the "driver" — the topmost actively-playing video element
      // whose currentTime we use to sync the timeline.
      let driverClip: ActiveClip | null = null;
      for (const ac of activeClips) {
        if (ac.videoElement && !ac.videoElement.paused && ac.videoElement.readyState >= 2) {
          driverClip = ac;
          break;
        }
      }

      if (driverClip && driverClip.videoElement) {
        const { clip, videoElement } = driverClip;
        const mappedTime = clip.timelineStart + (videoElement.currentTime - clip.sourceStart);
        const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);

        if (videoElement.currentTime >= clip.sourceEnd || mappedTime >= clipEnd) {
          // Clip boundary — pause all video elements and advance past the boundary
          this.videoPool.pauseAll();
          state.setCurrentTime(clipEnd);
          this.playStartWallTime = now;
        } else {
          state.setCurrentTime(mappedTime);
          this.playStartWallTime = now;

          // Sync all other active video elements to this same timeline position
          for (const ac of activeClips) {
            if (ac === driverClip || !ac.videoElement) continue;
            if (ac.videoElement.paused && ac.videoElement.readyState >= 2) {
              const srcTime = this.mapTimelineToSourceTime(ac.clip, mappedTime);
              const dur = ac.videoElement.duration || 0;
              if (dur > 0) {
                ac.videoElement.currentTime = Math.min(Math.max(srcTime, 0), dur);
              }
              ac.videoElement.play().catch(() => {});
            }
          }
        }
      } else if (this.playStartWallTime !== null) {
        // Wall-clock fallback: no video is playing (gap or no clips)
        const elapsedSec = (now - this.playStartWallTime) / 1000;
        const newTime = state.playback.currentTime + elapsedSec;

        const compositionDuration = state.getDuration();
        if (compositionDuration > 0 && newTime >= compositionDuration) {
          state.setCurrentTime(compositionDuration);
          this.pause();
          return;
        }

        state.setCurrentTime(newTime);
        this.playStartWallTime = now;

        // Check if we've entered any clip during gap playback
        const newActiveClips = this.getActiveVideoClips(newTime);
        for (const ac of newActiveClips) {
          if (!ac.videoElement) continue;
          if (ac.videoElement.paused || ac.videoElement.readyState < 2) {
            const sourceTime = this.mapTimelineToSourceTime(ac.clip, newTime);
            const dur = ac.videoElement.duration || 0;
            if (dur > 0) {
              ac.videoElement.currentTime = Math.min(Math.max(sourceTime, 0), dur);
              this.timeSyncSuppressedUntil = performance.now() + 150;
            }
            ac.videoElement.play().catch(() => {});
          }
        }
      }
    }

    this.processAnimations(now);
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

  /**
   * Renders all active video clips, composited bottom-to-top (V1 first, V3 last).
   * Each clip is drawn with its own transform, opacity, and CSS filters.
   */
  private renderFrame(): void {
    if (!this.canvas || !this.ctx) return;

    const { canvas, ctx } = this;

    try {
      const state = this.getState();

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const hasClips = state.project.tracks.some((t) => t.clips.length > 0);
      if (!hasClips) {
        this.drawPlaceholder();
        return;
      }

      const activeClips = this.getActiveVideoClips(state.playback.currentTime);
      if (activeClips.length === 0) return;

      for (const { clip, videoElement } of activeClips) {
        if (!videoElement || videoElement.readyState < 2) continue;
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) continue;

        const clipTime = state.playback.currentTime - clip.timelineStart;
        const transform = hasAnyKeyframes(clip.effects)
          ? effectsToTransformAtTime(clip.effects, clipTime)
          : clip.transform;

        // Compute fade opacity from transition effects (fade_in / fade_out).
        // These are time-based so they can't be baked into the static transform.
        let effectOpacity = transform.opacity;
        const clipTime = state.playback.currentTime - clip.timelineStart;

        for (const effect of clip.effects) {
          if (!effect.enabled) continue;
          if (effect.effectId === 'fade_in') {
            const duration = effect.parameters.duration ?? 1.0;
            if (duration > 0 && clipTime >= 0 && clipTime < duration) {
              effectOpacity *= clipTime / duration;
            }
          } else if (effect.effectId === 'fade_out') {
            const duration = effect.parameters.duration ?? 1.0;
            const clipDuration = clip.sourceEnd - clip.sourceStart;
            const fadeStart = effect.parameters.start ?? Math.max(0, clipDuration - duration);
            if (duration > 0 && clipTime >= fadeStart) {
              const progress = Math.min(1, (clipTime - fadeStart) / duration);
              effectOpacity *= 1 - progress;
            }
          }
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, effectOpacity));
        ctx.filter = buildCSSFilter(transform.filters);

        ctx.translate(
          canvas.width / 2 + transform.positionX,
          canvas.height / 2 + transform.positionY
        );

        if (transform.rotation !== 0) {
          ctx.rotate((transform.rotation * Math.PI) / 180);
        }

        ctx.scale(transform.scale, transform.scale);

        // Resolve source region — full frame by default, cropped if a crop effect is active.
        const cropEffect = clip.effects.find((e) => e.enabled && e.effectId === 'crop');
        const srcW = cropEffect
          ? (cropEffect.parameters.width ?? videoElement.videoWidth)
          : videoElement.videoWidth;
        const srcH = cropEffect
          ? (cropEffect.parameters.height ?? videoElement.videoHeight)
          : videoElement.videoHeight;
        // Default x/y to center the crop region; use explicit values if provided.
        const srcX = cropEffect
          ? (cropEffect.parameters.x ?? (videoElement.videoWidth - srcW) / 2)
          : 0;
        const srcY = cropEffect
          ? (cropEffect.parameters.y ?? (videoElement.videoHeight - srcH) / 2)
          : 0;

        // Use the cropped dimensions to compute the on-canvas draw size.
        const videoAspect = srcW / srcH;
        const canvasAspect = canvas.width / canvas.height;

        let drawWidth: number, drawHeight: number;
        if (videoAspect > canvasAspect) {
          drawWidth = canvas.width;
          drawHeight = canvas.width / videoAspect;
        } else {
          drawHeight = canvas.height;
          drawWidth = canvas.height * videoAspect;
        }

        // 9-arg drawImage: draws only [srcX, srcY, srcW, srcH] of the source.
        ctx.drawImage(
          videoElement,
          srcX, srcY, srcW, srcH,
          -drawWidth / 2,
          -drawHeight / 2,
          drawWidth,
          drawHeight
        );

        ctx.restore();
      }
    } catch (err) {
      console.warn('[VideoEngine] renderFrame error:', err);
    }
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

  // ─── Public Getters ───────────────────────────────────────────────────

  getFPS(): number {
    return this.fps;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  hasSourceLoaded(): boolean {
    return this.videoPool.getAnyLoaded() !== null;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement ?? this.videoPool.getAnyLoaded();
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
//
// IMPORTANT: We store the instance on globalThis instead of a module-level
// variable so the engine SURVIVES Hot Module Replacement (HMR). When HMR
// re-evaluates this module, a `let` would reset to null, orphaning the old
// engine (still running its render loop + holding the loaded video source)
// and creating a new uninitialized one — breaking playback every time code
// is edited. globalThis persists across module re-evaluations.

const ENGINE_KEY = '__chatcut_video_engine__' as const;

export function getVideoEngine(): VideoEngine {
  const existing = (globalThis as Record<string, unknown>)[ENGINE_KEY];
  if (existing instanceof VideoEngine) return existing;

  // Discard stale engine from previous HMR cycle / SSR that might be
  // missing methods after code changes.
  const engine = new VideoEngine();
  (globalThis as Record<string, unknown>)[ENGINE_KEY] = engine;
  return engine;
}

export function destroyVideoEngine(): void {
  const engine = (globalThis as Record<string, unknown>)[ENGINE_KEY] as VideoEngine | undefined;
  if (engine) {
    engine.destroy();
    delete (globalThis as Record<string, unknown>)[ENGINE_KEY];
  }
}
