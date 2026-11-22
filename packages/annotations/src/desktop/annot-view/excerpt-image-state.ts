import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { ExcerptImageDisplay } from "#desktop/excerpt-image/display.ts";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "#obsidian/annotation-repository/service.ts";

import {
  excerptFingerprint,
  excerptSourceIdentity,
} from "#obsidian/excerpt-image/service.ts";

export interface ExcerptImageTarget {
  key: string;
  identity: string;
  annotation: AnnotationRecord;
  source: AnnotationSource | null;
  sourceScope: string | null;
}

export function excerptImageTarget(
  previous: ExcerptImageTarget | null,
  input: Omit<ExcerptImageTarget, "key" | "identity">,
): ExcerptImageTarget {
  const { annotation } = input;
  const identity = JSON.stringify([
    annotation.key,
    annotation.parentKey,
    input.sourceScope,
    input.source && excerptSourceIdentity(input.source),
  ]);
  const key = JSON.stringify([identity, excerptFingerprint(annotation)]);
  return previous?.key === key ? previous : { key, identity, ...input };
}

export interface ExcerptImageOwnership {
  identity: string;
  image: ExcerptImage;
  url: string;
}

export function excerptImageOwnership(options: {
  held: ExcerptImageOwnership | null;
  display: ExcerptImageDisplay;
  identity: string;
  create: (image: ExcerptImage) => string;
}): { owned: ExcerptImageOwnership | null; release: string[] } {
  const { held, display, identity, create } = options;
  const image = display.image;
  const keep =
    held &&
    held.identity === identity &&
    display.status !== "cleared" &&
    (image === null || image === held.image);
  if (keep) return { owned: held, release: [] };
  const url = image ? create(image) : null;
  const owned = image && url ? { identity, image, url } : null;
  return { owned, release: held ? [held.url] : [] };
}
