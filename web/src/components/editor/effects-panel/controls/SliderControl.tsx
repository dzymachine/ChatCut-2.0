"use client";

import { useCallback, useRef, useState } from "react";
import { Slider } from "radix-ui";
import type { ProvenanceEntry } from "@/types/editor";
import { ProvenanceBadge } from "../ai/ProvenanceBadge";
import { StopwatchToggle } from "./StopwatchToggle";
import { KeyframeStrip } from "./KeyframeStrip";

interface KeyframeConfig {
  clipId: string;
  effectId: string;
  parameterId: string;
  clipDuration: number;
}

interface SliderControlProps {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  onChangeEnd?: () => void;
  disabled?: boolean;
  provenance?: ProvenanceEntry | null;
  keyframeConfig?: KeyframeConfig;
}

function getDecimalPlaces(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

function formatValue(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function SliderControl({
  label,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  unit,
  onChange,
  onChangeEnd,
  disabled = false,
  provenance,
  keyframeConfig,
}: SliderControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const sliderAreaRef = useRef<HTMLDivElement>(null);

  const decimals = getDecimalPlaces(step);
  const isDefault = value === defaultValue;

  const handleSliderChange = useCallback(
    (values: number[]) => {
      const raw = values[0];
      if (raw !== undefined) {
        onChange(Number(raw.toFixed(decimals)));
      }
    },
    [onChange, decimals],
  );

  const handleSliderCommit = useCallback(() => {
    onChangeEnd?.();
  }, [onChangeEnd]);

  const handleInputFocus = useCallback(() => {
    setIsEditing(true);
    setInputValue(formatValue(value, decimals));
    requestAnimationFrame(() => inputRef.current?.select());
  }, [value, decimals]);

  const commitInput = useCallback(() => {
    setIsEditing(false);
    const parsed = Number.parseFloat(inputValue);
    if (!Number.isNaN(parsed)) {
      const clamped = clamp(
        Number(parsed.toFixed(decimals)),
        min,
        max,
      );
      onChange(clamped);
      onChangeEnd?.();
    }
  }, [inputValue, min, max, decimals, onChange, onChangeEnd]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        setIsEditing(false);
        e.currentTarget.blur();
      }
    },
    [],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      const multiplier = e.shiftKey ? 0.1 : 1;
      const delta = e.deltaY < 0 ? step * multiplier : -step * multiplier;
      const next = clamp(
        Number((value + delta).toFixed(decimals)),
        min,
        max,
      );
      onChange(next);
    },
    [disabled, step, value, decimals, min, max, onChange],
  );

  const handleReset = useCallback(() => {
    onChange(defaultValue);
    onChangeEnd?.();
  }, [defaultValue, onChange, onChangeEnd]);

  return (
    <div className={disabled ? "opacity-50 pointer-events-none" : ""}>
    <div className="h-7 flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-neutral-400 truncate select-none flex items-center gap-1">
        {keyframeConfig && (
          <StopwatchToggle
            clipId={keyframeConfig.clipId}
            effectId={keyframeConfig.effectId}
            parameterId={keyframeConfig.parameterId}
            currentValue={value}
          />
        )}
        {label}
      </span>

      <div
        ref={sliderAreaRef}
        className="flex-1 flex items-center"
        onWheel={handleWheel}
      >
        <Slider.Root
          className="relative flex w-full touch-none items-center select-none h-5"
          value={[value]}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
        >
          <Slider.Track className="relative h-1 w-full rounded-full bg-neutral-700">
            <Slider.Range className="absolute h-full rounded-full bg-blue-500" />
            {provenance && provenance.source !== 'user' && provenance.previousValue != null && (
              <span
                className="absolute top-1/2 -translate-y-1/2 w-1.5 h-3 rounded-sm bg-purple-400/40 pointer-events-none"
                style={{
                  left: `${clamp(((Number(provenance.previousValue) - min) / (max - min)) * 100, 0, 100)}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                title={`Previous: ${provenance.previousValue}`}
              />
            )}
          </Slider.Track>
          <Slider.Thumb className="block w-3 h-3 rounded-full bg-white border border-neutral-500 shadow-sm outline-none transition-shadow hover:ring-2 hover:ring-blue-500/30 focus-visible:ring-2 focus-visible:ring-blue-500/30" />
        </Slider.Root>
      </div>

      <div className="w-[60px] shrink-0 flex items-center justify-end">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-neutral-800 rounded border border-neutral-600 text-right text-xs text-neutral-200 font-mono px-1 py-0 h-5 outline-none"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={commitInput}
            onKeyDown={handleInputKeyDown}
          />
        ) : (
          <button
            type="button"
            className="w-full bg-transparent border-0 text-right text-xs text-neutral-200 font-mono cursor-text px-1 h-5 rounded hover:bg-neutral-800 transition-colors"
            onClick={handleInputFocus}
            tabIndex={0}
          >
            {formatValue(value, decimals)}
            {unit ? <span className="text-neutral-400 ml-0.5">{unit}</span> : null}
          </button>
        )}
      </div>

      {provenance && provenance.source !== 'user' && (
        <ProvenanceBadge entry={provenance} />
      )}

      <button
        type="button"
        className={`w-4 h-4 shrink-0 flex items-center justify-center text-neutral-500 hover:text-neutral-300 cursor-pointer transition-opacity ${isDefault ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        onClick={handleReset}
        tabIndex={isDefault ? -1 : 0}
        aria-label={`Reset ${label}`}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5"
        >
          <path d="M2.5 2.5v4h4" />
          <path d="M2.8 6.5a5.5 5.5 0 1 1 .9-2" />
        </svg>
      </button>
    </div>
    {keyframeConfig && (
      <div className="pl-20 ml-1">
        <KeyframeStrip
          clipId={keyframeConfig.clipId}
          effectId={keyframeConfig.effectId}
          parameterId={keyframeConfig.parameterId}
          clipDuration={keyframeConfig.clipDuration}
          currentValue={value}
        />
      </div>
    )}
    </div>
  );
}
