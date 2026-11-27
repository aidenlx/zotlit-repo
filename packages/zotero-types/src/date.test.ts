import { describe, expect, it } from "vitest";

import { isMultipartDate } from "./date.ts";

describe("isMultipartDate, as Zotero.Date.isMultipart decides", () => {
  it("accepts a multipart value with zero parts", () => {
    expect(isMultipartDate("2020-03-00 March 2020")).toBe(true);
    expect(isMultipartDate("0000-00-00 Spring")).toBe(true);
  });

  it("rejects an SQL date and time and a value without the text part", () => {
    expect(isMultipartDate("2020-03-04 12:30:00")).toBe(false);
    expect(isMultipartDate("2020-03-04 12:30")).toBe(false);
    expect(isMultipartDate("2020-03-04")).toBe(false);
    expect(isMultipartDate("2020-13-04 x")).toBe(false);
    expect(isMultipartDate("January 2020")).toBe(false);
  });
});
