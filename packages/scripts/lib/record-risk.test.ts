import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { LAND_RECORD_ENV, LAND_RECORD_PATH } from "./land.ts";
import { readLandRecord, riskLine, riskVerdict } from "./record-risk.ts";

const change = { subject: "Contract Citations CLI", old: "4", new: "5" };
const record = (risk: string, summary = "The change.") =>
  [
    "# feat: x",
    "## Summary",
    summary,
    "## Risk",
    risk,
    "## How to revert",
    "Revert it.",
  ].join("\n");

describe("riskLine", () => {
  it("names the subject and both values", () => {
    expect(riskLine(change)).toBe("Contract Citations CLI: 4 → 5");
  });
});

describe("riskVerdict", () => {
  it("passes when nothing changed", () => {
    expect(
      riskVerdict({ changes: [], record: undefined, required: true }),
    ).toEqual({ ok: true, lines: [] });
  });

  it("without a record file, prints the line that the record needs and passes", () => {
    const verdict = riskVerdict({
      changes: [change],
      record: undefined,
      required: false,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.lines).toContain("Contract Citations CLI: 4 → 5");
    expect(verdict.lines.join("\n")).toContain(LAND_RECORD_PATH);
  });

  it("inside a land without a record file, fails and names the path it tried", () => {
    const verdict = riskVerdict({
      changes: [change],
      record: undefined,
      required: true,
      path: "/tmp/land/copy.record.md",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.lines[0]).toContain("/tmp/land/copy.record.md");
    expect(verdict.lines).toContain("Contract Citations CLI: 4 → 5");
  });

  it.each([
    "Contract Citations CLI: 4 → 5",
    "- Contract Citations CLI: 4 -> 5, so agents that read version 4 must update.",
    "-   Contract   Citations CLI:  4  →  5",
  ])("passes a record whose Risk section names the change: %s", (line) => {
    expect(
      riskVerdict({ changes: [change], record: record(line), required: true }),
    ).toEqual({ ok: true, lines: [] });
  });

  it("reads numbers with or without thousands separators", () => {
    const bundle = {
      subject: "Bundle desktop main.js",
      old: "4,989,060 B",
      new: "5,071,000 B",
    };
    expect(
      riskVerdict({
        changes: [bundle],
        record: record("Bundle desktop main.js: 4989060 B → 5071000 B"),
        required: true,
      }).ok,
    ).toBe(true);
  });

  it("fails when only another section names the change, and prints the line to copy", () => {
    const verdict = riskVerdict({
      changes: [change],
      record: record("Low.", "Contract Citations CLI: 4 → 5"),
      required: false,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.lines).toContain("Contract Citations CLI: 4 → 5");
    expect(verdict.lines.join("\n")).toContain("## Risk");
  });

  it("fails on a line whose new number only starts with the needed one", () => {
    expect(
      riskVerdict({
        changes: [change],
        record: record("Contract Citations CLI: 4 → 50"),
        required: true,
      }).ok,
    ).toBe(false);
  });

  it("inside a land, names the copy it checked and the record file to edit", () => {
    const verdict = riskVerdict({
      changes: [change],
      record: record("Low."),
      required: true,
      path: "/tmp/land/copy.record.md",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.lines[0]).toContain("/tmp/land/copy.record.md");
    expect(verdict.lines[0]).toContain(`edit ${LAND_RECORD_PATH}`);
    expect(verdict.lines[0]).toContain("land again");
  });

  it("fails on a line with other numbers", () => {
    expect(
      riskVerdict({
        changes: [change],
        record: record("Contract Citations CLI: 3 → 4"),
        required: true,
      }).ok,
    ).toBe(false);
  });
});

describe("readLandRecord", () => {
  const scratch = mkdtemp(join(tmpdir(), "zt-record-risk-"));
  afterAll(async () => rm(await scratch, { recursive: true, force: true }));

  it("reads the copy that the land gives the gate, and then requires it", async () => {
    const root = await scratch;
    await mkdir(join(root, ".scratch"), { recursive: true });
    await writeFile(join(root, LAND_RECORD_PATH), "worktree file");
    const copy = join(root, "copy.md");
    await writeFile(copy, "land copy");
    expect(await readLandRecord(root, { [LAND_RECORD_ENV]: copy })).toEqual({
      record: "land copy",
      required: true,
      path: copy,
    });
    expect(await readLandRecord(root, {})).toEqual({
      record: "worktree file",
      required: false,
      path: LAND_RECORD_PATH,
    });
  });
});
