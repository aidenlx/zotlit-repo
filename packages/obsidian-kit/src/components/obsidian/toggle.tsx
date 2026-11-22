import { ToggleComponent } from "obsidian";
import { useLayoutEffect, useRef } from "react";

export interface ToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Toggle({
  value,
  onChange,
  disabled = false,
  id,
  "aria-label": label,
  "aria-labelledby": labelledBy,
}: ToggleProps) {
  const container = useRef<HTMLSpanElement>(null);
  const component = useRef<ToggleComponent | null>(null);

  useLayoutEffect(() => {
    const toggle = new ToggleComponent(container.current!);
    component.current = toggle;
    return () => {
      toggle.toggleEl.remove();
      component.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const toggle = component.current!;
    toggle
      .onChange((next) => {
        if (next !== value) onChange(next);
      })
      .setValue(value)
      .setDisabled(disabled);
    toggle.toggleEl.id = id ?? "";
    toggle.toggleEl.setAttribute("role", "switch");
    if (labelledBy === undefined)
      toggle.toggleEl.setAttribute("aria-label", label ?? "");
    else toggle.toggleEl.setAttribute("aria-labelledby", labelledBy);
    toggle.toggleEl.setAttribute("aria-checked", String(value));
    toggle.toggleEl.setAttribute("aria-disabled", String(disabled));
  }, [value, onChange, disabled, id, label, labelledBy]);

  return <span ref={container} />;
}
