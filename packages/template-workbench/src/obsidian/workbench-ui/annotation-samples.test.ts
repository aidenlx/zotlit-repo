import { expect, it } from "vitest";

import { annotationSamples } from "./annotation-samples.ts";

import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "#core/render/index.ts";

it("keeps bundled annotation identity when the Item changes and current identity when reordered", () => {
  const bundled = SAMPLE_ANNOTATIONS[2]!;
  expect(annotationSamples(SAMPLE_ITEMS[0]!, bundled.id).example).toBe(bundled);
  expect(annotationSamples(SAMPLE_ITEMS[1]!, bundled.id).example).toBe(bundled);
  const original = SAMPLE_ITEMS.find(
    (item) => item.roots.annotations.length > 0,
  )!;
  const sample = {
    ...original,
    roots: {
      ...original.roots,
      annotations: [
        original.roots.annotations[0]!,
        { ...original.roots.annotations[0]!, indexedKey: "second" },
      ],
    },
    descriptors: {
      ...original.descriptors,
      annotations: [
        original.descriptors.annotations[0]!,
        original.descriptors.annotations[0]!,
      ],
    },
  };
  const selection = annotationSamples(sample, null).current[1]!;
  const reordered = {
    ...sample,
    roots: {
      ...sample.roots,
      annotations: sample.roots.annotations.toReversed(),
    },
    descriptors: {
      ...sample.descriptors,
      annotations: sample.descriptors.annotations.toReversed(),
    },
  };
  expect(
    annotationSamples(reordered, selection.id).example.root.indexedKey,
  ).toBe(selection.root.indexedKey);
  expect(annotationSamples(reordered, selection.id).example.descriptors).toBe(
    selection.descriptors,
  );
});
