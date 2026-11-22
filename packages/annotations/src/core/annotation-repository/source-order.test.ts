import { expect, it } from "vitest";

import {
  annotationPage,
  ROUGIER_ANNOTATIONS,
  unreachable,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/__fixtures__.ts";

import { writable } from "#__fixtures__/annotation-repository.ts";

it("hands a failed list read back only after the repository handled the source change it announced", async () => {
  await using stack = new AsyncDisposableStack();
  let failing = false;
  const { repository, localApiService, localApiBridge } = await writable(
    stack,
    {
      children: () =>
        failing ? unreachable() : annotationPage(ROUGIER_ANNOTATIONS),
    },
  );
  using _hold = repository.hold(["RGRPDF24"]);
  await repository.read("RGRPDF24");

  let announced = false;
  stack.defer(
    repository.listen("annotations-changed", (attachmentKey) => {
      if (attachmentKey === "RGRPDF24") announced = true;
    }),
  );
  failing = true;
  const failure = await localApiBridge.runPromise(
    localApiService.listAnnotations("RGRPDF24"),
  );
  const announcedWhenCallerHasFailure = announced;

  expect(failure).toEqual({ failure: { kind: "unreachable" } });
  expect(announcedWhenCallerHasFailure).toBe(true);
});
