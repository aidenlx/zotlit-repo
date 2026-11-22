import { regex } from "arkregex";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runImageTag } from "./container-image.ts";

const versions = {
  platform: "linux/arm64",
  pnpm: "12.3.4",
  obsidian: "1.15.1",
  zotero: "10.0.1",
};
let context: string;
beforeEach(() => {
  context = mkdtempSync(join(tmpdir(), "run-image-"));
  writeFileSync(join(context, "Dockerfile"), "FROM node:26\n");
  writeFileSync(join(context, "entry.sh"), "exec pnpm e2e\n");
});
afterEach(() => rmSync(context, { recursive: true, force: true }));

describe("Run Container image tag", () => {
  it("uses a stable tag for a given set of image inputs", () => {
    const tag = runImageTag(context, versions);
    expect(tag).toBe(runImageTag(context, { ...versions }));
    expect(tag).toMatch(regex("^zotlit-e2e:[0-9a-f]{16}$"));
  });

  it.each([
    ["platform", "linux/amd64"],
    ["pnpm", "12.3.5"],
    ["obsidian", "1.15.2"],
    ["zotero", "10.0.2"],
  ])("changes when the %s input changes", (input, value) => {
    expect(runImageTag(context, { ...versions, [input]: value })).not.toBe(
      runImageTag(context, versions),
    );
  });

  it.each([
    ["Dockerfile", "FROM node:27\n"],
    ["entry.sh", "exec pnpm e2e --project=desktop\n"],
  ])("changes when %s changes", (file, content) => {
    const before = runImageTag(context, versions);
    writeFileSync(join(context, file), content);
    expect(runImageTag(context, versions)).not.toBe(before);
  });
});
