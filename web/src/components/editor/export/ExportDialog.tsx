"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import {
  isTauri,
  saveFileDialog,
  exportVideo,
  getExportProgress,
  cancelExport,
  type ExportClip,
  type ExportSettings,
  type ExportProgress,
} from "@/lib/tauri/bridge";

// ─── Types ──────────────────────────────────────────────────────────────────

type ExportFormat = "mp4" | "webm" | "mov";
type VideoCodec = "h264" | "h265" | "vp9" | "prores";
type QualityPreset = "low" | "medium" | "high" | "lossless";
type AudioCodec = "aac" | "opus" | "pcm";

interface FormatConfig {
  label: string;
  codecs: VideoCodec[];
  audioCodecs: AudioCodec[];
  extension: string;
}

const FORMAT_OPTIONS: Record<ExportFormat, FormatConfig> = {
  mp4: {
    label: "MP4",
    codecs: ["h264", "h265"],
    audioCodecs: ["aac"],
    extension: "mp4",
  },
  webm: {
    label: "WebM",
    codecs: ["vp9"],
    audioCodecs: ["opus"],
    extension: "webm",
  },
  mov: {
    label: "MOV (ProRes)",
    codecs: ["prores", "h264"],
    audioCodecs: ["aac", "pcm"],
    extension: "mov",
  },
};

const QUALITY_OPTIONS: Record<QualityPreset, string> = {
  low: "Draft (fast, larger file)",
  medium: "Standard",
  high: "High Quality",
  lossless: "Lossless (very large file)",
};

const RESOLUTION_PRESETS = [
  { label: "1080p (1920x1080)", width: 1920, height: 1080 },
  { label: "720p (1280x720)", width: 1280, height: 720 },
  { label: "4K (3840x2160)", width: 3840, height: 2160 },
  { label: "480p (854x480)", width: 854, height: 480 },
  { label: "Custom", width: 0, height: 0 },
];

// ─── Component ──────────────────────────────────────────────────────────────

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  // Settings state
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [codec, setCodec] = useState<VideoCodec>("h264");
  const [quality, setQuality] = useState<QualityPreset>("medium");
  const [audioCodec, setAudioCodec] = useState<AudioCodec>("aac");
  const [audioBitrate] = useState("192k");
  const [resolutionPreset, setResolutionPreset] = useState(0); // index into RESOLUTION_PRESETS
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [outputPath, setOutputPath] = useState("");

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const project = useEditorStore((s) => s.project);

  // Sync codec when format changes
  useEffect(() => {
    const config = FORMAT_OPTIONS[format];
    if (!config.codecs.includes(codec)) {
      setCodec(config.codecs[0]);
    }
    if (!config.audioCodecs.includes(audioCodec)) {
      setAudioCodec(config.audioCodecs[0]);
    }
  }, [format, codec, audioCodec]);

  // Get current resolution
  const resolution = resolutionPreset < RESOLUTION_PRESETS.length - 1
    ? RESOLUTION_PRESETS[resolutionPreset]
    : { label: "Custom", width: customWidth, height: customHeight };

  // Choose output path
  const handleChoosePath = useCallback(async () => {
    const defaultName = `${project.name || "export"}.${FORMAT_OPTIONS[format].extension}`;
    const path = await saveFileDialog(defaultName);
    if (path) {
      setOutputPath(path);
    }
  }, [project.name, format]);

  // Build export clips from the project
  const buildExportClips = useCallback((): ExportClip[] => {
    const clips: ExportClip[] = [];
    const mediaFiles = useEditorStore.getState().mediaFiles;

    for (const track of project.tracks) {
      if (track.type !== "video") continue;

      for (const clip of track.clips) {
        const mediaFile = mediaFiles.get(clip.sourceFileId);
        if (!mediaFile) continue;

        // Use native file path for FFmpeg export (required on desktop)
        const sourcePath = mediaFile.nativePath || mediaFile.previewUrl;
        if (!mediaFile.nativePath) {
          console.warn(`[Export] Clip ${clip.id}: no native path, export may fail`);
        }
        clips.push({
          sourcePath,
          sourceStart: clip.sourceStart,
          sourceEnd: clip.sourceEnd,
          timelineStart: clip.timelineStart,
          effects: clip.effects.map((e) => ({
            id: e.id,
            effectId: e.effectId,
            parameters: { ...e.parameters },
            enabled: e.enabled,
          })),
        });
      }
    }

    // Sort by timeline position
    clips.sort((a, b) => a.timelineStart - b.timelineStart);
    return clips;
  }, [project.tracks]);

  // Start export
  const handleExport = useCallback(async () => {
    if (!outputPath) {
      setError("Please choose an output file location.");
      return;
    }

    const clips = buildExportClips();
    if (clips.length === 0) {
      setError("No video clips to export. Add media to the timeline first.");
      return;
    }

    setError(null);
    setIsExporting(true);
    setProgress({
      percent: 0,
      frame: 0,
      totalFrames: 0,
      speed: "0x",
      eta: 0,
      running: true,
      error: null,
    });

    try {
      const settings: ExportSettings = {
        outputPath,
        format,
        codec,
        width: resolution.width,
        height: resolution.height,
        fps: project.composition.fps,
        quality,
        audioCodec,
        audioBitrate: audioBitrate,
      };

      await exportVideo(clips, settings);

      // Start polling for progress
      progressIntervalRef.current = setInterval(async () => {
        try {
          const prog = await getExportProgress();
          setProgress(prog);

          if (!prog.running) {
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = null;
            }
            if (prog.error) {
              setError(prog.error);
            }
            setIsExporting(false);
          }
        } catch (err) {
          console.error("Failed to get export progress:", err);
        }
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
      setIsExporting(false);
    }
  }, [outputPath, buildExportClips, format, codec, resolution, project.composition.fps, quality, audioCodec, audioBitrate]);

  // Cancel export
  const handleCancel = useCallback(async () => {
    try {
      await cancelExport();
    } catch (err) {
      console.error("Failed to cancel export:", err);
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setIsExporting(false);
    setProgress(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const isDesktop = isTauri();
  const isComplete = progress && !progress.running && progress.percent >= 100 && !progress.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] max-h-[90vh] overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <h2 className="text-base font-semibold text-white">Export Video</h2>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {!isDesktop && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
              Export requires the desktop version of ChatCut with FFmpeg installed.
            </div>
          )}

          {/* Format */}
          <fieldset disabled={isExporting}>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">Format</label>
            <div className="flex gap-2">
              {(Object.keys(FORMAT_OPTIONS) as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                    format === f
                      ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                      : "bg-neutral-800 text-neutral-400 border border-neutral-700 hover:border-neutral-600"
                  }`}
                >
                  {FORMAT_OPTIONS[f].label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Codec */}
          <fieldset disabled={isExporting}>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">Video Codec</label>
            <select
              value={codec}
              onChange={(e) => setCodec(e.target.value as VideoCodec)}
              className="w-full px-3 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {FORMAT_OPTIONS[format].codecs.map((c) => (
                <option key={c} value={c}>
                  {c === "h264" ? "H.264" : c === "h265" ? "H.265 (HEVC)" : c === "vp9" ? "VP9" : "ProRes"}
                </option>
              ))}
            </select>
          </fieldset>

          {/* Quality */}
          <fieldset disabled={isExporting}>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">Quality</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as QualityPreset)}
              className="w-full px-3 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {(Object.keys(QUALITY_OPTIONS) as QualityPreset[]).map((q) => (
                <option key={q} value={q}>{QUALITY_OPTIONS[q]}</option>
              ))}
            </select>
          </fieldset>

          {/* Resolution */}
          <fieldset disabled={isExporting}>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">Resolution</label>
            <select
              value={resolutionPreset}
              onChange={(e) => setResolutionPreset(Number(e.target.value))}
              className="w-full px-3 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {RESOLUTION_PRESETS.map((r, i) => (
                <option key={i} value={i}>{r.label}</option>
              ))}
            </select>
            {resolutionPreset === RESOLUTION_PRESETS.length - 1 && (
              <div className="flex gap-2 mt-2">
                <input
                  type="number"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(Number(e.target.value))}
                  placeholder="Width"
                  className="flex-1 px-3 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-neutral-500 self-center text-sm">x</span>
                <input
                  type="number"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(Number(e.target.value))}
                  placeholder="Height"
                  className="flex-1 px-3 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            )}
          </fieldset>

          {/* Output Path */}
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">Output File</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputPath}
                readOnly
                placeholder="Choose output location..."
                className="flex-1 px-3 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm text-neutral-300 placeholder:text-neutral-600 focus:outline-none"
              />
              <button
                onClick={handleChoosePath}
                disabled={isExporting}
                className="px-3 py-1.5 rounded-md bg-neutral-700 text-sm text-white hover:bg-neutral-600 disabled:opacity-50 transition-colors"
              >
                Browse
              </button>
            </div>
          </div>

          {/* Progress */}
          {isExporting && progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>
                  {progress.error
                    ? "Export failed"
                    : isComplete
                    ? "Export complete!"
                    : `Exporting... ${progress.percent.toFixed(1)}%`}
                </span>
                <span>{progress.speed}</span>
              </div>
              <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    progress.error
                      ? "bg-red-500"
                      : isComplete
                      ? "bg-emerald-500"
                      : "bg-indigo-500"
                  }`}
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              {progress.frame > 0 && (
                <div className="text-[10px] text-neutral-500">
                  Frame {progress.frame}
                  {progress.totalFrames > 0 ? ` / ${progress.totalFrames}` : ""}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Success */}
          {isComplete && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
              Video exported successfully to {outputPath}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-800">
          {isExporting ? (
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-md bg-red-600/20 text-red-300 text-sm font-medium hover:bg-red-600/30 transition-colors"
            >
              Cancel Export
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-md bg-neutral-800 text-neutral-300 text-sm font-medium hover:bg-neutral-700 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleExport}
                disabled={!isDesktop || !outputPath}
                className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
