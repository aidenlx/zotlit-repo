import { customAlphabet } from "nanoid";

import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  hasSuffixMarker,
  replaceSuffixMarkers,
  resolveFlatNoteName,
  resolveNoteRelPath,
} from "@zotlit/templates";

const suffixNanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
);

export function randomFilenameId(size: number): string {
  return suffixNanoid(size);
}

export class EmptyFilenameError extends Error {
  constructor() {
    super(m.notice_empty_filename());
    this.name = "EmptyFilenameError";
  }
}

export const MAX_SUFFIX_ATTEMPTS = 5;

export function resolveFreeFlatName(
  rendered: string,
  exists: (rel: string) => boolean,
): string {
  const base = baseNoteName(rendered, resolveFlatNoteName);
  if (!hasSuffixMarker(rendered) || !exists(base)) return base;
  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = suffixedNoteName(rendered, resolveFlatNoteName);
    if (!exists(candidate)) return candidate;
  }
  throw noFreeName(base);
}

export function baseNoteName(
  rendered: string,
  resolveName: (rendered: string) => string | null = resolveNoteRelPath,
): string {
  return resolvedName(
    replaceSuffixMarkers(rendered, () => ""),
    resolveName,
  );
}

export function suffixedNoteName(
  rendered: string,
  resolveName: (rendered: string) => string | null = resolveNoteRelPath,
): string {
  return resolvedName(
    replaceSuffixMarkers(
      rendered,
      ({ length, prepend, append }) =>
        `${prepend}${suffixNanoid(length)}${append}`,
    ),
    resolveName,
  );
}

export function noFreeName(base: string): Error {
  return new Error(
    `Could not find an available filename for "${base}" after ${MAX_SUFFIX_ATTEMPTS} suffix attempts`,
  );
}

function resolvedName(
  filled: string,
  resolveName: (rendered: string) => string | null,
): string {
  const rel = resolveName(filled);
  if (rel === null) throw new EmptyFilenameError();
  return rel;
}
