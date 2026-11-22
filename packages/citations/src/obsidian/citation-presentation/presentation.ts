import type { ReferencesStyleOption } from "#core/pandoc/citation-style.ts";
import type { InstalledCslStyle } from "#core/pandoc/csl-style.ts";
import type { CachedMetadata, TFile } from "obsidian";

import { processLiveFrontMatter } from "@zotlit/obsidian-kit/live-text.ts";
import type { LiveTextApp } from "@zotlit/obsidian-kit/live-text.ts";
import {
  FIELD_CITATION_STYLE,
  FIELD_DOCUMENT_LANGUAGE,
} from "@zotlit/plugin-kernel/constants.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import {
  referencesStyleOptions,
  STYLE_DEFAULT,
} from "#core/pandoc/citation-style.ts";

export const STYLE_INHERITED = "";

export interface DeclaredPresentation {
  styleId: string | null;
  language: string;
}

export interface CitationPresentationChoice {
  styleId: string | null;
  language: string | null;
}

export function declaredPresentation(
  cache: CachedMetadata | null,
): DeclaredPresentation {
  const frontmatter = cache?.frontmatter;
  const styleId = frontmatter?.[FIELD_CITATION_STYLE] as unknown;
  const language = frontmatter?.[FIELD_DOCUMENT_LANGUAGE] as unknown;
  return {
    styleId:
      typeof styleId === "string" && styleId.trim() ? styleId.trim() : null,
    language: typeof language === "string" ? language.trim() : "",
  };
}

export function stylePickerOptions(
  styles: readonly InstalledCslStyle[],
  {
    selected,
    vaultStyleId,
  }: { selected: string | null; vaultStyleId: string | null },
): ReferencesStyleOption[] {
  const options: ReferencesStyleOption[] = [
    {
      value: STYLE_INHERITED,
      label: m.citation_presentation_style_inherited({
        style: vaultStyleLabel(styles, vaultStyleId),
      }),
    },
    ...styles.map((style) => ({ value: style.id, label: style.title })),
  ];
  if (selected !== null && !styles.some((style) => style.id === selected)) {
    options.push({
      value: selected,
      label: m.settings_citation_references_style_missing({ id: selected }),
      disabled: true,
    });
  }
  return options;
}

function vaultStyleLabel(
  styles: readonly InstalledCslStyle[],
  vaultStyleId: string | null,
): string {
  const selected = vaultStyleId ?? STYLE_DEFAULT;
  return referencesStyleOptions(styles, selected).find(
    (option) => option.value === selected,
  )!.label;
}

export function applyCitationPresentation(
  app: LiveTextApp,
  file: TFile,
  { styleId, language }: CitationPresentationChoice,
): Promise<void> {
  return processLiveFrontMatter(app, file, (frontmatter) => {
    if (styleId === null) delete frontmatter[FIELD_CITATION_STYLE];
    else frontmatter[FIELD_CITATION_STYLE] = styleId;
    if (language === null) delete frontmatter[FIELD_DOCUMENT_LANGUAGE];
    else frontmatter[FIELD_DOCUMENT_LANGUAGE] = language;
  });
}
