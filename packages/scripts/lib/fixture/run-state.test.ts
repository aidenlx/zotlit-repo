import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getFixtureLayout } from "./layout.ts";
import {
  clearPairedRunState,
  livePairedZotero,
  pairedRunStatePath,
  readPairedRunState,
  writePairedRunState,
} from "./run-state.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixtureRoot(): Promise<ReturnType<typeof getFixtureLayout>> {
  const root = await mkdtemp(join(tmpdir(), "zotlit-run-state-"));
  roots.push(root);
  return getFixtureLayout(root);
}

describe("Paired Run state", () => {
  it("reads back the Paired Zotero the run reported", async () => {
    const layout = await fixtureRoot();

    await writePairedRunState(layout, { pid: 4321, debuggerPort: 57241 });

    expect(pairedRunStatePath(layout)).toBe(
      join(layout.root, "paired-zotero.json"),
    );
    await expect(readPairedRunState(layout)).resolves.toEqual({
      pid: 4321,
      debuggerPort: 57241,
    });
  });

  it("replaces what an earlier run reported", async () => {
    const layout = await fixtureRoot();

    await writePairedRunState(layout, { pid: 1, debuggerPort: 2 });
    await writePairedRunState(layout, { pid: 3, debuggerPort: 4 });

    await expect(readPairedRunState(layout)).resolves.toEqual({
      pid: 3,
      debuggerPort: 4,
    });
  });

  it("answers null where no run has reported one", async () => {
    const layout = await fixtureRoot();

    await expect(readPairedRunState(layout)).resolves.toBeNull();
  });

  it("reads back a Zotero started without a debugger", async () => {
    const layout = await fixtureRoot();

    await writePairedRunState(layout, { pid: 4321 });

    await expect(readPairedRunState(layout)).resolves.toEqual({ pid: 4321 });
  });

  it.each([
    ["malformed JSON", "{"],
    ["a JSON scalar", '"57241"'],
    ["a report with no process id", JSON.stringify({ debuggerPort: 57241 })],
    [
      "a report whose ports are not numbers",
      JSON.stringify({ pid: "4321", debuggerPort: "57241" }),
    ],
  ])("answers null for %s", async (_label, source) => {
    const layout = await fixtureRoot();
    await writeFile(pairedRunStatePath(layout), source);

    await expect(readPairedRunState(layout)).resolves.toBeNull();
  });
});

describe("the Paired Zotero holding the Fixture", () => {
  it("names the reported instance while its process runs", async () => {
    const layout = await fixtureRoot();
    await writePairedRunState(layout, { pid: 4321, debuggerPort: 57241 });

    await expect(
      livePairedZotero(layout, { isAlive: (pid) => pid === 4321 }),
    ).resolves.toEqual({ pid: 4321, debuggerPort: 57241 });
  });

  it("names a Zotero holding the Fixture with no debugger of its own", async () => {
    const layout = await fixtureRoot();
    await writePairedRunState(layout, { pid: 4321 });

    await expect(
      livePairedZotero(layout, { isAlive: () => true }),
    ).resolves.toEqual({ pid: 4321 });
  });

  it("answers null for a report its process has outlived", async () => {
    const layout = await fixtureRoot();
    await writePairedRunState(layout, { pid: 4321, debuggerPort: 57241 });

    await expect(
      livePairedZotero(layout, { isAlive: () => false }),
    ).resolves.toBeNull();
  });

  it("answers null where no run has reported one", async () => {
    const layout = await fixtureRoot();

    await expect(
      livePairedZotero(layout, { isAlive: () => true }),
    ).resolves.toBeNull();
  });

  it("stops naming an instance once the report is cleared", async () => {
    const layout = await fixtureRoot();
    await writePairedRunState(layout, { pid: 4321, debuggerPort: 57241 });

    await clearPairedRunState(layout);

    await expect(readPairedRunState(layout)).resolves.toBeNull();
    await expect(clearPairedRunState(layout)).resolves.toBeUndefined();
  });
});
