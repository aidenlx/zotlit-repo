import type { ReactNode } from "react";

import { Select } from "@zotlit/obsidian-kit/components/select.tsx";

import { useMatchLook } from "./match.look.ts";
import { WorkbenchSelect } from "./select.tsx";

/** One choice of a Match editor select. */
export interface MatchSelectOption {
  value: string;
  label: string;
  /** The glyph before the label, such as the icon of a property's type. */
  icon?: ReactNode;
  /**
   * Muted text after the label in the popup list, such as a field's path. A
   * native select shows the label alone.
   */
  detail?: string;
  /** Words the search also finds the choice by; they are never shown. */
  searchTerms?: readonly string[];
}

/** What a Match editor select takes. */
export interface MatchSelectProps {
  "aria-label": string;
  value: string;
  options: readonly MatchSelectOption[];
  /** Shown while the value names no option, such as a choice not yet made. */
  placeholder?: string;
  /**
   * A list long or open-ended enough to search, such as the fields a
   * condition can test, which the plugin's popup select draws. A few fixed
   * choices stay a native select.
   */
  searchable?: boolean;
  onChange: (value: string) => void;
  "data-part"?: string;
  className?: string;
}

/**
 * A select of the Match editor, which reports the chosen value. A searchable
 * one is the plugin's popup select with a search field, as Bases picks a
 * property or an operator; otherwise it is a native select, with the chosen
 * option's icon before it.
 */
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
