import { expect, it } from "vitest";

import { legacyArrival } from "./legacy-arrival.ts";

const arrival = { pathname: "/docs/x", searchStr: "?from=v1&src=/old" };

it("names the v1 page a reader arrived from", () => {
  expect(legacyArrival(arrival, null)).toEqual({
    key: "/docs/x?from=v1&src=/old",
    isZh: false,
    v1Src: "/old",
  });
});

it("reads the Chinese edition of the v1 page", () => {
  expect(
    legacyArrival(
      { ...arrival, searchStr: `${arrival.searchStr}&lang=zh-CN` },
      null,
    )?.isZh,
  ).toBe(true);
});

it.each(["", "?from=v1", "?from=v1&src=//other.site/page", "?src=/old"])(
  "finds no arrival in %j",
  (searchStr) => {
    expect(legacyArrival({ pathname: "/docs/y", searchStr }, null)).toBeNull();
  },
);

it("keeps a dismissed arrival hidden and shows a later one", () => {
  const dismissed = legacyArrival(arrival, null)?.key ?? null;
  expect(legacyArrival(arrival, dismissed)).toBeNull();
  expect(
    legacyArrival(
      { pathname: "/docs/y", searchStr: "?from=v1&src=/other" },
      dismissed,
    )?.v1Src,
  ).toBe("/other");
});
