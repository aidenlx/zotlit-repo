import type { ReactNode } from "react";

import { Select } from "@zotlit/obsidian-kit/components/select.tsx";

import { useMatchLook } from "./match.look.ts";
import { WorkbenchSelect } from "./select.tsx";

export interface MatchSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  detail?: string;
  searchTerms?: readonly string[];
}

export interface MatchSelectProps {
  "aria-label": string;
  value: string;
  options: readonly MatchSelectOption[];
  placeholder?: string;
  searchable?: boolean;
  onChange: (value: string) => void;
  "data-part"?: string;
  className?: string;
}

export function MatchSelect({ searchable, ...props }: MatchSelectProps) {
  const look = useMatchLook();
  if (searchable) return <Select {...props} />;
  const { value, options, placeholder, onChange, ...rest } = props;
  const current = options.find((option) => option.value === value);
  return (
    <>
      {current?.icon !== undefined && (
        <span aria-hidden data-part="kind-icon" className={look("kind-icon")}>
          {current.icon}
        </span>
      )}
      <WorkbenchSelect {...rest} value={value} onChange={onChange}>
        {current === undefined &&
          (value === "" ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : (
            <option value={value}>{value}</option>
          ))}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </WorkbenchSelect>
    </>
  );
}
