import type { WorkbenchSliceId } from "#core/document/index.ts";
import { expect, it } from "vitest";

import { workbenchDiagnoses } from "./problems.ts";
import type { WorkbenchDiagnosis } from "./problems.ts";
import { sourceDiagnostics } from "./source-diagnostics.tsx";

import {
  entrySlice,
  WorkbenchDocumentController,
} from "#core/document/controller.ts";
import { sliceShownText } from "#core/document/index.ts";
import { DEFAULT_PROFILE_SOURCE } from "#core/render/default-profile.ts";

function marked({
  controller,
  slice,
  diagnoses,
  json = false,
}: {
  controller: WorkbenchDocumentController;
  slice: WorkbenchSliceId;
  diagnoses: readonly WorkbenchDiagnosis[];
  json?: boolean;
}): string[] {
  const source = sliceShownText(controller, slice);
  return sourceDiagnostics({ controller, slice, source, diagnoses, json }).map(
    ({ from, to }) => source.slice(from, to),
  );
}

it("marks a verified note failure at its place in the note pane", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const source = controller.sliceText("note");
  const from = controller.sliceRange("note").from;
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "render-error",
        message: "Broken template",
        sourceSite: { source, offset: from, from: from + 2, to: from + 4 },
      },
    ],
  );
  const found = sourceDiagnostics({
    controller,
    slice: "note",
    source: sliceShownText(controller, "note"),
    diagnoses,
    json: false,
  });
  expect(
    found.map(({ from, to, severity }) => ({ from, to, severity })),
  ).toEqual([{ from: 2, to: 4, severity: "error" }]);
  expect(found[0]!.diagnosisId).toBe(diagnoses[0]!.id);
});

it("marks the expression a JSON-e property rule failed on, in the row's own pane", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "property-error",
        params: { key: "citekey", detail: 'object has no property "nope"' },
        part: "properties",
        position: 4,
        sliceSite: {
          kind: "path",
          path: [],
          source: '{"$eval":"zt.citationKey"}',
        },
      },
    ],
  );
  expect(
    marked({ controller, slice: entrySlice(4), diagnoses, json: true }),
  ).toEqual(['"zt.citationKey"']);
  expect(marked({ controller, slice: entrySlice(1), diagnoses })).toEqual([]);
});

it("marks a failure in a quoted Liquid rule at the text the row shows", () => {
  const rule = "zt.title | append: '-' | nope";
  const controller = new WorkbenchDocumentController(
    DEFAULT_PROFILE_SOURCE.replace(
      "expr: zt.title",
      `expr: '${rule.replaceAll("'", "''")}'`,
    ),
  );
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "property-error",
        params: { key: "title", detail: "undefined filter: nope" },
        part: "properties",
        position: 1,
        sliceSite: {
          kind: "span",
          from: rule.indexOf("nope"),
          to: rule.length,
          source: rule,
        },
      },
    ],
  );
  expect(sliceShownText(controller, entrySlice(1))).toBe(rule);
  expect(marked({ controller, slice: entrySlice(1), diagnoses })).toEqual([
    "nope",
  ]);
});

it("marks a note-name failure in the note-name pane alone", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const source = controller.document!.manifest.filename;
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "liquid-syntax-error",
        message: "illegal tag",
        part: "filename",
        sliceSite: {
          kind: "span",
          from: source.indexOf("zt.citationKey"),
          to: source.indexOf("zt.citationKey") + "zt.citationKey".length,
          source,
        },
      },
    ],
  );
  expect(marked({ controller, slice: "filename", diagnoses })).toEqual([
    "zt.citationKey",
  ]);
  expect(marked({ controller, slice: "note", diagnoses })).toEqual([]);
});

it("leaves the note-name pane unmarked for a note-body failure", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const note = controller.sliceText("note");
  const offset = controller.sliceRange("note").from;
  const diagnoses = workbenchDiagnoses(
    [],
    [
      {
        code: "render-error",
        message: "Broken template",
        part: "render",
        sourceSite: { source: note, offset, from: offset + 2, to: offset + 4 },
      },
    ],
  );
  expect(marked({ controller, slice: "filename", diagnoses })).toEqual([]);
});
