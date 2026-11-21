import type { TemplateRenderResult } from "#core/render/result.ts";
import { expect, it } from "vitest";

import { previewFilename } from "./result-column.tsx";

import { failedRender } from "#core/render/result.ts";

const result: TemplateRenderResult = {
  ...failedRender(
    { sourceRevision: "1", snapshotRevision: "2" },
    { code: "render-error" },
  ),
  filename: "Papers/Reading.md",
  creationBody: "Created note",
  diagnostics: [],
};

it("names the file a note preview shows, and none for a failure or another mode", () => {
  const reading = {
    result,
    mode: "note",
    staleReason: null,
    showManaged: false,
  } as const;
  expect(previewFilename(reading)).toBe("Papers/Reading.md");
  expect(previewFilename({ ...reading, mode: "annotation" })).toBeNull();
  expect(
    previewFilename({
      ...reading,
      result: {
        ...result,
        diagnostics: [
          { code: "property-error", position: 2, message: "Invalid property" },
        ],
      },
    }),
  ).toBeNull();
});
