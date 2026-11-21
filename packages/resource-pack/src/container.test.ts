import { describe, expect, it } from "vitest";

import { cases } from "./container.browser-test.ts";

describe("Pack container", () => {
  it.each(cases)("$name", async ({ run, expected }) => {
    expect(await run()).toEqual(expected);
  });
});
