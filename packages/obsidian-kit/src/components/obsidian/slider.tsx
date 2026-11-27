import { useState } from "react";
import type { CSSProperties, InputHTMLAttributes, Ref } from "react";

import { cn } from "#utils.ts";

function getValuePretty(value: number, step: number | "any"): string {
  return step === "any" || step < 1 ? value.toFixed(2) : value.toString();
}

export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max" | "step"
> {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number | "any";
  instant?: boolean;
  dynamicTooltip?: boolean;
  formatValue?: (value: number) => string;
  "data-tooltip-position"?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  instant = false,
  dynamicTooltip,
  formatValue,
  className,
  style,
  ref,
  "data-tooltip-position": tooltipPosition,
  ...rest
}: SliderProps) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (!Object.is(synced, value)) {
    setSynced(value);
    setDraft(value);
  }

  const commit = () => {
    if (!instant && draft !== value) onChange(draft);
  };

  const ariaLabel = dynamicTooltip
    ? (formatValue ?? ((v: number) => getValuePretty(v, step)))(draft)
    : rest["aria-label"];

  return (
    <input
      ref={ref}
      type="range"
      data-ignore-swipe="true"
      min={min}
      max={max}
      step={step}
      value={draft}
      data-tooltip-position={
        tooltipPosition ?? (dynamicTooltip ? "top" : undefined)
      }
      {...rest}
      aria-label={ariaLabel}
      className={cn("slider", className)}
      style={
        {
          "--slider-fill-ratio": max > min ? (draft - min) / (max - min) : 0,
          ...style,
        } as CSSProperties
      }
      onChange={(e) => {
        const next = e.currentTarget.valueAsNumber;
        setDraft(next);
        if (instant) onChange(next);
      }}
      onMouseUp={commit}
      onTouchEnd={commit}
      onKeyUp={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
