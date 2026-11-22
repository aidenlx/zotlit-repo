import type { InputHTMLAttributes, Ref } from "react";

import { cn } from "#utils.ts";

export interface ColorProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  value: string;
  onChange: (next: string) => void;
  ref?: Ref<HTMLInputElement>;
}

export function Color({
  value,
  onChange,
  className,
  ref,
  ...rest
}: ColorProps) {
  return (
    <input
      ref={ref}
      type="color"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      {...rest}
      className={cn(className)}
    />
  );
}
