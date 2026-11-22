import { expect, it } from "vitest";

import { expressionVocabulary } from "./expression-vocabulary.ts";

const typeOf = (
  vocabulary: ReturnType<typeof expressionVocabulary>,
  text: string,
) => vocabulary.receiver?.(text, { from: 0, to: text.length })?.type;

it("reads the Query Dataset of the view, and Annotations in a view without one", () => {
  expect(typeOf(expressionVocabulary({ dataset: "items" }), "dateAdded")).toBe(
    "date",
  );
  expect(typeOf(expressionVocabulary({ dataset: "annotations" }), "text")).toBe(
    "string",
  );
  expect(typeOf(expressionVocabulary({ dataset: undefined }), "text")).toBe(
    "string",
  );
});

it("reads no vault property unless the view gives them", () => {
  expect(expressionVocabulary({ dataset: "items" }).vault).toBeUndefined();
});
