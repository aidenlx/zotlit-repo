import * as m from "@zotlit/plugin-messages/messages.ts";

import type { InstalledCslStyle } from "./csl-style.ts";

export function citationStyleLabel(
  id: string | null = null,
  styles: readonly InstalledCslStyle[] = [],
): string {
  if (!id) return m.settings_citation_references_style_default();
  return styles.find((style) => style.id === id)?.title ?? id;
}

export const STYLE_DEFAULT = "";

export interface ReferencesStyleOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function referencesStyleOptions(
  styles: readonly InstalledCslStyle[],
  selected: string,
): ReferencesStyleOption[] {
  const options: ReferencesStyleOption[] = [
    {
      value: STYLE_DEFAULT,
      label: citationStyleLabel(),
    },
    ...styles.map((style) => ({ value: style.id, label: style.title })),
  ];
  if (selected !== STYLE_DEFAULT && !styles.some((s) => s.id === selected)) {
    options.push({
      value: selected,
      label: m.settings_citation_references_style_missing({ id: selected }),
    });
  }
  return options;
}
