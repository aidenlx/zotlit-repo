import type { AnnotationExample } from "#core/render/index.ts";

import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";

import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "#core/render/index.ts";

export function annotationSamples(
  snapshot: ItemSnapshot,
  selection: string | null,
) {
  const source =
    snapshot.provenance.kind === "sample"
      ? `sample:${snapshot.provenance.id}`
      : `connected:${snapshot.provenance.installationId}`;
  const current: readonly AnnotationExample[] = snapshot.roots.annotations.map(
    (root, index) => ({
      id: JSON.stringify([source, root.indexedKey]),
      revision: snapshot.revision,
      root,
      descriptors: snapshot.descriptors.annotations[index]!,
    }),
  );
  const example =
    [...current, ...SAMPLE_ANNOTATIONS].find(({ id }) => id === selection) ??
    current[0] ??
    SAMPLE_ANNOTATIONS[0]!;
  return { current, example };
}

export interface AnnotationExamples {
  readonly current: readonly AnnotationExample[];
  readonly example: AnnotationExample | null;
}

const NO_EXAMPLES: AnnotationExamples = { current: [], example: null };

export function annotationExamples(
  chosen: boolean,
  snapshot: ItemSnapshot | null,
  annotationId: string | null,
): AnnotationExamples {
  if (!chosen)
    return {
      current: [],
      example:
        SAMPLE_ANNOTATIONS.find((sample) => sample.id === annotationId) ?? null,
    };
  return snapshot ? annotationSamples(snapshot, annotationId) : NO_EXAMPLES;
}

export function sampleAnnotationParent(id: string): ItemSnapshot | null {
  const parent = SAMPLE_ANNOTATIONS.find((sample) => sample.id === id)?.root
    .parentItem as Record<string, unknown> | undefined;
  return (
    SAMPLE_ITEMS.find(
      (sample) => sample.item.indexedKey === parent?.indexedKey,
    ) ?? null
  );
}
