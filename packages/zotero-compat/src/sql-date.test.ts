import { describe, expect, it } from "vitest";

import { accessDateToSql, instantToSql, isoToSql } from "./sql-date.ts";

describe("accessDateToSql, as the fromJSON and setField of the client store an access date", () => {
  it.each([
    ["2015-06-07T20:56:00Z", "2015-06-07 20:56:00"],
    ["2017-04-05", "2017-04-05"],
    ["foo", undefined],
  ])("stores %j as Zotero's item test expects", (value, stored) => {
    expect(accessDateToSql(value, "UTC")).toBe(stored);
  });

  it.each([
    ["2020-01-02", "2020-01-02"],
    ["2020-01-02T03:04:05Z", "2020-01-02 03:04:05"],
    ["2020-01-02T03:04:05.678+01:00", "2020-01-02 02:04:05"],
    ["2020-01-02T03:04Z", "2020-01-02 03:04:00"],
    ["2020-01", "2020-01-01 00:00:00"],
    ["2020", "2020-01-01 00:00:00"],
    ["2020-01-02 03:04:05", undefined],
    ["2020-01-02 03:04:05Z", undefined],
    [" 2020-01-02", undefined],
    ["2020-13-02T03:04:05Z", undefined],
    ["2024-02-29T24:00:00Z", "2024-03-01 00:00:00"],
    ["2024-12-31T24:00Z", "2025-01-01 00:00:00"],
    ["2024-02-29T24:00:00.000+02:00", "2024-02-29 22:00:00"],
    ["2024-02-29T24:00:01Z", undefined],
    ["2024-02-29T24:00:00.5Z", undefined],
    ["CURRENT_TIMESTAMP", undefined],
  ])("stores %j as %j", (value, stored) => {
    expect(accessDateToSql(value, "UTC")).toBe(stored);
  });

  it("reads a local end-of-day hour in the given time zone as the next local midnight, across a daylight-saving gap", () => {
    expect(accessDateToSql("2024-09-08T24:00", "America/Santiago")).toBe(
      "2024-09-09 03:00:00",
    );
  });
});

describe("isoToSql, as the fromJSON of the client stores dateAdded and dateModified", () => {
  it("stores the ISO 8601 dates of Zotero's item test in UTC SQL time", () => {
    expect(isoToSql("2015-06-07T20:57:00Z", "UTC")).toBe("2015-06-07 20:57:00");
    expect(isoToSql("2015-06-07T20:58:00Z", "UTC")).toBe("2015-06-07 20:58:00");
  });

  it("reads an item date at the end of a day as the start of the next day, as the client's Date does", () => {
    expect(isoToSql("2024-02-29T24:00:00Z", "UTC")).toBe("2024-03-01 00:00:00");
    expect(isoToSql("2024-12-31T24:00:00Z", "UTC")).toBe("2025-01-01 00:00:00");
    expect(isoToSql("2024-09-07T24:00:00", "America/Santiago")).toBe(
      "2024-09-08 04:00:00",
    );
  });

  it("gives no value for a value that is not an ISO 8601 date, so the importer chooses the stored time", () => {
    expect(isoToSql(undefined, "UTC")).toBeNull();
    expect(isoToSql("", "UTC")).toBeNull();
    expect(isoToSql("2015-06-07 20:57:00", "UTC")).toBeNull();
    expect(isoToSql("2024-02-30T00:00:00Z", "UTC")).toBeNull();
  });
});

describe("instantToSql, as dateToSQL(date, true) of the client writes a time", () => {
  it("writes UTC SQL time to the second", () => {
    expect(
      instantToSql(Temporal.Instant.from("2001-02-03T04:05:06.789Z")),
    ).toBe("2001-02-03 04:05:06");
    expect(
      instantToSql(Temporal.Instant.from("2024-03-01T00:30:00+02:00")),
    ).toBe("2024-02-29 22:30:00");
  });
});
