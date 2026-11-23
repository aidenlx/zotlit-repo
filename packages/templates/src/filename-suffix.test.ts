import { describe, expect, it } from "vitest";

import {
  filenameSuffix,
  hasSuffixMarker,
  replaceSuffixMarkers,
} from "./filename-suffix.ts";

describe("filenameSuffix", () => {
  it("emits a marker carrying the default length and prepend", () => {
    expect(filenameSuffix()).toBe("%zt-suffix:6:_:%");
  });

  it("emits a marker carrying an explicit length", () => {
    expect(filenameSuffix(10)).toBe("%zt-suffix:10:_:%");
  });

  it("emits a marker carrying custom prepend and append affixes", () => {
    expect(filenameSuffix(6, " (", ")")).toBe("%zt-suffix:6: (:)%");
  });

  it.each([0, -1, 1.5, Number.NaN, 65, 100000000])(
    "rejects out-of-range length %s",
    (n) => {
      expect(() => filenameSuffix(n)).toThrow(/length must be an integer/);
    },
  );

  it("accepts the maximum length", () => {
    expect(filenameSuffix(64)).toBe("%zt-suffix:64:_:%");
  });

  it.each([
    ["prepend", "a:b", ""],
    ["append", "", "x%y"],
  ])("rejects %s containing a delimiter char", (_label, prepend, append) => {
    expect(() => filenameSuffix(6, prepend, append)).toThrow(/':' or '%'/);
  });
});

describe("hasSuffixMarker", () => {
  it("detects a marker", () => {
    expect(hasSuffixMarker(`smith2020${filenameSuffix()}`)).toBe(true);
  });

  it("is false for plain text", () => {
    expect(hasSuffixMarker("smith2020")).toBe(false);
  });

  it("is false for malformed marker-like text", () => {
    expect(hasSuffixMarker("smith2020%zt-suffix:foo%")).toBe(false);
    expect(hasSuffixMarker("smith2020%zt-suffix:%")).toBe(false);
  });

  it.each([0, 65, 999999999])(
    "is false for a marker whose length is out of range (%s)",
    (length) => {
      expect(hasSuffixMarker(`smith2020%zt-suffix:${length}:_:%`)).toBe(false);
    },
  );

  it.each([1, 64])("detects a marker at the length limit %s", (length) => {
    expect(hasSuffixMarker(`smith2020%zt-suffix:${length}:_:%`)).toBe(true);
  });
});

describe("replaceSuffixMarkers", () => {
  it("fills each marker with its resolved spec", () => {
    const rendered = `a${filenameSuffix(4)}b${filenameSuffix(8, "-", "!")}`;
    const seen: Array<{ length: number; prepend: string; append: string }> = [];
    const out = replaceSuffixMarkers(rendered, (spec) => {
      seen.push(spec);
      return `${spec.prepend}<${spec.length}>${spec.append}`;
    });
    expect(out).toBe("a_<4>b-<8>!");
    expect(seen).toEqual([
      { length: 4, prepend: "_", append: "" },
      { length: 8, prepend: "-", append: "!" },
    ]);
  });

  it("drops markers when fill returns empty", () => {
    expect(replaceSuffixMarkers(`smith2020${filenameSuffix()}`, () => "")).toBe(
      "smith2020",
    );
  });

  it.each([0, 65, 999999999])(
    "leaves a marker whose length is out of range (%s) as literal text",
    (length) => {
      const rendered = `a%zt-suffix:${length}:_:%b${filenameSuffix(4)}`;
      const seen: number[] = [];
      const out = replaceSuffixMarkers(rendered, (spec) => {
        seen.push(spec.length);
        return "<filled>";
      });
      expect(out).toBe(`a%zt-suffix:${length}:_:%b<filled>`);
      expect(seen).toEqual([4]);
    },
  );

  it("fills a marker that directly follows an out-of-range marker", () => {
    expect(
      replaceSuffixMarkers(
        "%zt-suffix:0:_:%zt-suffix:6:_:%",
        (spec) => `<${spec.length}>`,
      ),
    ).toBe("%zt-suffix:0:_:<6>");
    expect(hasSuffixMarker("%zt-suffix:0:_:%zt-suffix:6:_:%")).toBe(true);
  });

  it("leaves marker-free text untouched", () => {
    expect(replaceSuffixMarkers("smith2020", () => "x")).toBe("smith2020");
  });
});
