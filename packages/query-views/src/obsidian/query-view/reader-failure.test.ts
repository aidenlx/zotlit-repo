import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planItemFilter } from "@zotlit/item-query";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type {
  LibraryRead,
  ViewFailureCode,
  ViewWarning,
} from "./reader-failure.ts";
import { readerFailureText, readerWarningText } from "./reader-failure.ts";

const READS = {
  loading: { state: "loading", dbFileMissing: false },
  ready: { state: "ready", dbFileMissing: false },
  degraded: { state: "degraded", dbFileMissing: false },
  missing: { state: "degraded", dbFileMissing: true },
} as const satisfies Record<string, LibraryRead>;

type ReadName = keyof typeof READS;

type Expected = "query-text" | (() => string);
type ByRead = Expected | Record<ReadName, Expected>;

const locate = () =>
  m.query_view_failure_database_missing({
    view: m.library_view_name(),
    action: m.library_view_locate(),
  });

const TABLE: Record<ViewFailureCode, ByRead> = {
  "source-unavailable": {
    loading: m.query_view_failure_library_loading,
    ready: m.query_view_failure_library_unavailable,
    degraded: m.query_view_failure_library_unavailable,
    missing: locate,
  },
  "database-error": m.query_view_failure_read_error,
  "unsupported-database-layout": m.query_view_failure_layout,
  "no-library-available": m.query_view_failure_no_library,
  "library-not-found": m.query_view_failure_library_not_found,
  "result-too-large": m.query_view_failure_too_large,
  "export-unavailable": m.query_view_failure_internal,
  "output-error": m.query_view_failure_internal,
  "invalid-argument": m.query_view_failure_internal,
  "query-id-in-use": m.query_view_failure_internal,
  "query-failed": m.query_view_failure_internal,
  "duplicate-library": "query-text",
  "invalid-group": "query-text",
  "invalid-path": "query-text",
  "unknown-field": "query-text",
  "unknown-path": "query-text",
  "unsortable-field": "query-text",
  "invalid-limit": "query-text",
  "invalid-filter": "query-text",
  "unfilterable-field": "query-text",
  "unknown-function": "query-text",
  "unknown-property": "query-text",
  "wrong-argument-count": "query-text",
  "wrong-argument-type": "query-text",
  "wrong-operand-type": "query-text",
  "invalid-context": "query-text",
  "unbound-context": "query-text",
  "invalid-formula-name": "query-text",
  "invalid-formula-result": "query-text",
  "unknown-formula": "query-text",
  "formula-cycle": "query-text",
  "reads-faulted-formula": "query-text",
  "vault-filter-nested": "query-text",
  "vault-filter-mixed": "query-text",
};

const cases = Object.entries(TABLE).flatMap(([code, byRead]) =>
  (Object.keys(READS) as ReadName[]).map(
    (read) =>
      [
        code as ViewFailureCode,
        read,
        typeof byRead === "object" ? byRead[read] : byRead,
      ] as const,
  ),
);

describe("the reader text of a failed Query View", () => {
  it.each(cases)(
    "gives %s, while the library is %s, its catalogue text or the text of the query",
    (code, read, expected) => {
      const text = readerFailureText(
        { code, message: "ENVELOPE-MESSAGE", hint: "ENVELOPE-HINT" },
        READS[read],
      );
      expect(text).toBe(
        expected === "query-text"
          ? "ENVELOPE-MESSAGE ENVELOPE-HINT"
          : expected(),
      );
    },
  );

  it("has an English and a Chinese text for each catalogue message", () => {
    const keys = [
      "query_view_failure_library_loading",
      "query_view_failure_library_unavailable",
      "query_view_failure_database_missing",
      "query_view_failure_read_error",
      "query_view_failure_layout",
      "query_view_failure_no_library",
      "query_view_failure_library_not_found",
      "query_view_failure_too_large",
      "query_view_failure_internal",
      "query_view_failure_formula_undefined",
      "query_view_warning_unknown_collection",
    ];
    for (const locale of ["en", "zh-CN"]) {
      const messages = JSON.parse(
        readFileSync(
          new URL(`../../../../../messages/${locale}.json`, import.meta.url),
          "utf8",
        ),
      ) as Record<string, unknown>;
      expect(keys.filter((key) => typeof messages[key] !== "string")).toEqual(
        [],
      );
    }
  });

  it("drops the command line hint of a filter that reads this.item without a bound Item", () => {
    const planned = planItemFilter("this.item == item");
    expect("code" in planned && planned.code).toBe("unbound-context");
    if (!("code" in planned)) return;
    expect(planned.hint).toContain("zotlit:query");
    expect(readerFailureText(planned, READS.ready)).toBe(planned.message);
  });

  it("gives the field names of a correction in shell form, not the shell argument", () => {
    const text = readerFailureText(
      {
        code: "unknown-field",
        message: "ENVELOPE-MESSAGE",
        hint: `Try: fields='["title","date"]'`,
        suggestions: [`fields='["title","date"]'`],
        location: { argument: "fields" },
      },
      READS.ready,
    );
    expect(text).toBe("ENVELOPE-MESSAGE Try: title, date");
  });

  it.each([`"x='hello'"`, `"a=b"`])(
    "keeps the literal %s of a filter correction as the filter has it",
    (literal) => {
      const planned = planItemFilter(
        `title == ${literal} AND date.year > 2000`,
      );
      expect("code" in planned && planned.code).toBe("invalid-filter");
      if (!("code" in planned)) return;
      expect(readerFailureText(planned, READS.ready)).toBe(
        `${planned.message} Try: title == ${literal} && date.year > 2000`,
      );
    },
  );

  it("gives the field of a sort correction in shell form", () => {
    const text = readerFailureText(
      {
        code: "unsortable-field",
        message: "ENVELOPE-MESSAGE",
        hint: `Try: sort='[{"field":"date","direction":"desc"}]'`,
        suggestions: [`sort='[{"field":"date","direction":"desc"}]'`],
        location: { argument: "sort" },
      },
      READS.ready,
    );
    expect(text).toBe("ENVELOPE-MESSAGE Try: date");
  });

  it("keeps the candidate field names of a fault in the fields", () => {
    const text = readerFailureText(
      {
        code: "unknown-field",
        message: "ENVELOPE-MESSAGE",
        hint: "Use date.year, issueDate.year or filingDate.year.",
        suggestions: ["date.year", "issueDate.year", "filingDate.year"],
        location: { argument: "fields" },
      },
      READS.ready,
    );
    expect(text).toContain(
      m.query_view_diagnostic_corrections({
        suggestions: "date.year, issueDate.year, filingDate.year",
      }),
    );
  });

  it("tells the reader to add a formula that the view does not define", () => {
    const text = readerFailureText(
      {
        code: "unknown-formula",
        message: "ENVELOPE-MESSAGE",
        hint: `Define the Formula in formulas, such as formulas='{"year":"date.year"}'.`,
        found: "year",
        expected: [],
        suggestions: [],
        location: { argument: "filter" },
      },
      READS.ready,
    );
    expect(text).toBe(
      `ENVELOPE-MESSAGE ${m.query_view_failure_formula_undefined({
        name: "year",
        add: m.query_view_formula_add(),
      })}`,
    );
  });
});

const WARNINGS: Record<ViewWarning["code"], "message" | (() => string)> = {
  "key-outside-target-libraries": m.query_view_warning_outside_library_scope,
  "unknown-collection": () =>
    m.query_view_warning_unknown_collection({ path: "thesis/chapter 2" }),
  "never-true": "message",
  "always-true": "message",
  "unused-formula": "message",
};

describe("the reader text of a Query View warning", () => {
  it.each(Object.entries(WARNINGS))("shows %s", (code, expected) => {
    const text = readerWarningText({
      code: code as ViewWarning["code"],
      message: "ENVELOPE-MESSAGE",
      found: "thesis/chapter 2",
    });
    expect(text).toBe(expected === "message" ? "ENVELOPE-MESSAGE" : expected());
  });
});
