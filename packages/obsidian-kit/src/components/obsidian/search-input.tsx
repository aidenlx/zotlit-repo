import type { InputHTMLAttributes, Ref } from "react";

import { cn, tooltipAttrs } from "#utils.ts";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  value: string;
  onChange: (next: string) => void;
  clearLabel: string;
  type?: "search" | "text";
  ref?: Ref<HTMLInputElement>;
}

export function SearchInput({
  value,
  onChange,
  className,
  placeholder = "Search…",
  clearLabel,
  type = "search",
  ref,
  ...rest
}: SearchInputProps) {
  return (
    <div className={cn("search-input-container", className)}>
      <input
        ref={ref}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        {...rest}
      />
      <div
        className="search-input-clear-button"
        role="button"
        {...tooltipAttrs(clearLabel)}
        onClick={() => onChange("")}
      />
    </div>
  );
}
