'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/lib/store/editor-store';
import { useShallow } from 'zustand/react/shallow';
import type { EffectKeyframe } from '@/types/effects';

const EMPTY_KF: EffectKeyframe[] = [];

interface SpeedRampEditorProps {
  clipId: string;
  effectId: string;
  clipDuration: number;
}

const CANVAS_HEIGHT = 160;
const PADDING = { top: 10, bottom: 20, left: 35, right: 10 };
const MAX_RATE = 4;
const MIN_RATE = 0;
const POINT_RADIUS = 4;
const HIT_RADIUS = 8;

const PRESETS = [
  { label: 'Linear', points: [] as { t: number; v: number }[] },
  { label: 'Ramp In', points: [{ t: 0, v: 0.25 }, { t: 1, v: 2 }] },
  { label: 'Ramp Out', points: [{ t: 0, v: 2 }, { t: 1, v: 0.25 }] },
  { label: 'Pulse', points: [{ t: 0, v: 1 }, { t: 0.33, v: 2 }, { t: 0.66, v: 2 }, { t: 1, v: 1 }] },
  { label: 'Bounce', points: [{ t: 0, v: 2 }, { t: 0.5, v: 0.5 }, { t: 1, v: 2 }] },
] as const;

export function SpeedRampEditor({ clipId, effectId, clipDuration }: SpeedRampEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const keyframes = useEditorStore(
    useShallow((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          const effect = clip.effects.find((e) => e.id === effectId);
          if (effect) {
            const filtered = effect.keyframes.filter((k) => k.parameterId === 'rate');
            return filtered.length > 0 ? filtered : EMPTY_KF;
          }
        }
      }
      return EMPTY_KF;
    })
  );
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const clipStart = useEditorStore((s) => {
    for (const track of s.project.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip.timelineStart;
    }
    return 0;
  });

  const getPlotDimensions = useCallback((canvas: HTMLCanvasElement) => {
    const w = canvas.width;
    const h = canvas.height;
    const plotW = w - PADDING.left - PADDING.right;
    const plotH = h - PADDING.top - PADDING.bottom;
    return { w, h, plotW, plotH };
  }, []);

  const timeToX = useCallback((t: number, plotW: number) =>
    PADDING.left + (t / clipDuration) * plotW
  , [clipDuration]);

  const rateToY = useCallback((r: number, plotH: number) =>
    PADDING.top + plotH - ((r - MIN_RATE) / (MAX_RATE - MIN_RATE)) * plotH
  , []);

  const xToTime = useCallback((x: number, plotW: number) =>
    ((x - PADDING.left) / plotW) * clipDuration
  , [clipDuration]);

  const yToRate = useCallback((y: number, plotH: number) =>
    MIN_RATE + ((PADDING.top + plotH - y) / plotH) * (MAX_RATE - MIN_RATE)
  , []);

  const getCanvasCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr,
    };
  }, []);

  // --- Resize Observer ---
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const dpr = window.devicePixelRatio || 1;
        const width = entry.contentRect.width;
        canvas.width = width * dpr;
        canvas.height = CANVAS_HEIGHT * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${CANVAS_HEIGHT}px`;
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // --- Canvas rendering ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h, plotW, plotH } = getPlotDimensions(canvas);
    if (plotW <= 0 || plotH <= 0) return;

    const txX = (t: number) => timeToX(t, plotW);
    const rtY = (r: number) => rateToY(r, plotH);

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (const rate of [0.5, 1, 2, 4]) {
      const y = rtY(rate);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(w - PADDING.right, y);
      ctx.stroke();

      ctx.fillStyle = '#666';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${rate}x`, PADDING.left - 4, y + 3);
    }

    // Baseline at 1x
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    const baseY = rtY(1);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, baseY);
    ctx.lineTo(w - PADDING.right, baseY);
    ctx.stroke();

    // Time axis labels
    if (clipDuration > 0) {
      ctx.fillStyle = '#555';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      const step = clipDuration <= 2 ? 0.5 : clipDuration <= 10 ? 1 : clipDuration <= 30 ? 5 : 10;
      for (let t = 0; t <= clipDuration; t += step) {
        const x = txX(t);
        ctx.fillText(`${t.toFixed(t % 1 === 0 ? 0 : 1)}s`, x, PADDING.top + plotH + 14);
      }
    }

    // Playhead
    const relTime = currentTime - clipStart;
    if (relTime >= 0 && relTime <= clipDuration) {
      ctx.strokeStyle = 'rgba(245,158,11,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(txX(relTime), PADDING.top);
      ctx.lineTo(txX(relTime), PADDING.top + plotH);
      ctx.stroke();
    }

    // Curve
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    if (sorted.length > 0) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(txX(0), rtY(sorted[0].value));
      for (const kf of sorted) {
        ctx.lineTo(txX(kf.time), rtY(kf.value));
      }
      ctx.lineTo(txX(clipDuration), rtY(sorted[sorted.length - 1].value));
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(txX(0), rtY(1));
      ctx.lineTo(txX(clipDuration), rtY(1));
      ctx.stroke();
    }

    // Points
    for (const kf of sorted) {
      const px = txX(kf.time);
      const py = rtY(kf.value);

      ctx.fillStyle = kf.id === draggingId ? '#3b82f6' : '#fff';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [keyframes, currentTime, clipStart, clipDuration, draggingId, getPlotDimensions, timeToX, rateToY]);

  // --- Hit testing ---
  const findHitPoint = useCallback((canvasX: number, canvasY: number): EffectKeyframe | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { plotW, plotH } = getPlotDimensions(canvas);

    for (const kf of keyframes) {
      const px = timeToX(kf.time, plotW);
      const py = rateToY(kf.value, plotH);
      const dx = canvasX - px;
      const dy = canvasY - py;
      if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) return kf;
    }
    return null;
  }, [keyframes, getPlotDimensions, timeToX, rateToY]);

  // --- Mouse handlers ---
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (e.button === 2) return; // right-click handled by context menu

    const { x, y } = getCanvasCoords(e);
    const hit = findHitPoint(x, y);

    if (hit) {
      setDraggingId(hit.id);
    } else {
      const { plotW, plotH } = getPlotDimensions(canvas);
      const time = Math.max(0, Math.min(clipDuration, xToTime(x, plotW)));
      const rate = Math.max(0.1, Math.min(MAX_RATE, yToRate(y, plotH)));
      addKeyframe(clipId, effectId, 'rate', time, rate);
    }
  }, [getCanvasCoords, findHitPoint, getPlotDimensions, xToTime, yToRate, clipDuration, addKeyframe, clipId, effectId]);

  useEffect(() => {
    if (!draggingId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x, y } = getCanvasCoords(e);
      const { plotW, plotH } = getPlotDimensions(canvas);
      const time = Math.max(0, Math.min(clipDuration, xToTime(x, plotW)));
      const rate = Math.max(0.1, Math.min(MAX_RATE, yToRate(y, plotH)));
      updateKeyframe(clipId, effectId, draggingId, { time, value: rate });
    };

    const handleMouseUp = () => setDraggingId(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, getCanvasCoords, getPlotDimensions, xToTime, yToRate, clipDuration, updateKeyframe, clipId, effectId]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = getCanvasCoords(e);
    const hit = findHitPoint(x, y);
    if (hit) {
      removeKeyframe(clipId, effectId, hit.id);
    }
  }, [getCanvasCoords, findHitPoint, removeKeyframe, clipId, effectId]);

  // --- Presets ---
  const applyPreset = useCallback((points: readonly { t: number; v: number }[]) => {
    for (const kf of keyframes) {
      removeKeyframe(clipId, effectId, kf.id);
    }
    for (const pt of points) {
      addKeyframe(clipId, effectId, 'rate', pt.t * clipDuration, pt.v);
    }
  }, [keyframes, clipDuration, removeKeyframe, addKeyframe, clipId, effectId]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => applyPreset(preset.points)}
            className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 transition-colors"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="w-full">
        <canvas
          ref={canvasRef}
          className="w-full rounded-md bg-neutral-950 border border-neutral-800"
          style={{ height: CANVAS_HEIGHT, cursor: draggingId ? 'grabbing' : 'crosshair' }}
          onMouseDown={handleMouseDown}
          onContextMenu={handleContextMenu}
        />
      </div>
    </div>
  );
}
