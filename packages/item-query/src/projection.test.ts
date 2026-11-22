import { expect, it } from "vitest";

import type { ValueShape } from "./fields.ts";
import { planPath, readPath } from "./projection.ts";
import type { ProjectionValue } from "./request.ts";

const creators: ValueShape = {
  kind: "list",
  element: {
    kind: "object",
    keys: { fullName: { kind: "scalar", type: "string" } },
  },
};

function project(text: string, shape: ValueShape, value: ProjectionValue) {
  const path = planPath<ProjectionValue, null>(text, ([, ...rest]) => ({
    field: { shape, needs: () => null, read: (row) => row },
    rest,
  }));
  if ("kind" in path) return path;
  return readPath(path, value);
}

it("keeps three creator positions when the middle fullName is missing", () => {
  expect(
    project("creators[].fullName", creators, [
      { fullName: "Ada Lovelace" },
      {},
      { fullName: "Grace Hopper" },
    ]),
  ).toEqual(["Ada Lovelace", null, "Grace Hopper"]);
});

it.each([
  [
    'creators[][]["fullName"]',
    [["Ada Lovelace", null], [], null, ["Grace Hopper"]],
  ],
  ["creators[][0].fullName", ["Ada Lovelace", null, null, "Grace Hopper"]],
  ["creators[0][].fullName", ["Ada Lovelace", null]],
  [
    "creators[][]",
    [
      [{ fullName: "Ada Lovelace" }, null],
      [],
      null,
      [{ fullName: "Grace Hopper" }],
    ],
  ],
] as const)("preserves nested list shape with %s", (path, expected) => {
  expect(
    project(path, { kind: "list", element: creators }, [
      [{ fullName: "Ada Lovelace" }, null],
      [],
      null,
      [{ fullName: "Grace Hopper" }],
    ]),
  ).toEqual(expected);
});

it("keeps whitespace inside empty brackets a syntax failure", () => {
  expect(project("creators[ ]", creators, [])).toMatchObject({
    kind: "plain",
    code: "invalid-path",
  });
});
