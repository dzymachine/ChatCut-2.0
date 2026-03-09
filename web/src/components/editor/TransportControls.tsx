"use client";

import { useEditorStore } from "@/lib/store/editor-store";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TransportControlsProps {
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
}

export function TransportControls({
  onTogglePlayback,
  onSeek,
}: TransportControlsProps) {
  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const duration = useEditorStore((s) => s.project.composition.duration);
  const volume = useEditorStore((s) => s.playback.volume);
  const isMuted = useEditorStore((s) => s.playback.isMuted);
  const setVolume = useEditorStore((s) => s.setVolume);
  const toggleMute = useEditorStore((s) => s.toggleMute);

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-neutral-900 border-t border-neutral-800">
      {/* Play/Pause Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onTogglePlayback}
            className="h-8 w-8 text-neutral-300 hover:text-white"
          >
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4l15 8-15 8V4z" />
              </svg>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{isPlaying ? "Pause" : "Play"} (Space)</p>
        </TooltipContent>
      </Tooltip>

      {/* Time Display */}
      <span className="text-xs text-neutral-400 font-mono min-w-[100px]">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {/* Seek Bar */}
      <div className="flex-1">
        <Slider
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.01}
          value={[currentTime]}
          onValueChange={([value]) => onSeek(value)}
          className="cursor-pointer"
        />
      </div>

      {/* Volume Controls */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMute}
              className="h-8 w-8 text-neutral-400 hover:text-white"
            >
              {isMuted || volume === 0 ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                </svg>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{isMuted ? "Unmute" : "Mute"}</p>
          </TooltipContent>
        </Tooltip>

        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[isMuted ? 0 : volume]}
          onValueChange={([value]) => {
            setVolume(value);
            if (value > 0 && isMuted) toggleMute();
          }}
          className="w-20 cursor-pointer"
        />
      </div>
    </div>
  );
}

// ── Helpers ──

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
