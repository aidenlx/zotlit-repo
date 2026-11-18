import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { githubRepository, requestLandE2e, runLandE2e } from "./land-e2e.ts";
import type { LandE2eDeps, LandE2eOutcome, LandE2eRecord } from "./land-e2e.ts";

// The runner's run and report are the process and network boundaries: the
// real ones check out, bootstrap, drive the desktop, and call `gh`.
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "land-e2e-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const request = (commit: string, previous = "p0") =>
  requestLandE2e(
    {
      commit,
      previous,
      repository: "/repo",
      issueRepository: "owner/repo",
      requestedAt: Temporal.Now.instant().toString(),
    },
    dir,
  );

function deps(outcomes: Record<string, LandE2eOutcome> = {}) {
  const ran: string[] = [];
  const reported: { range: string; stage: string }[] = [];
  const fake: LandE2eDeps = {
    run: ({ request: { commit } }) => {
      ran.push(commit);
      return Promise.resolve(outcomes[commit] ?? { outcome: "passed" });
    },
    report: ({ range, stage }) => {
      reported.push({ range, stage });
      return Promise.resolve(
        `https://github.com/owner/repo/issues/${reported.length}`,
      );
    },
  };
  return { fake, ran, reported };
}

const runner = (fake: LandE2eDeps) =>
  runLandE2e(fake, { dir, pollMs: 10, log: () => {} });

async function records(): Promise<LandE2eRecord[]> {
  return (await readFile(join(dir, "runs.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LandE2eRecord);
}

describe("the End-to-end Run after a land", () => {
  it("runs only the newest tip when several lands requested runs", async () => {
    const { fake, ran } = deps();
    await request("c1");
    await request("c2");
    await request("c3");

    await runner(fake);
    // The runners of the later lands find their tip already run.
    await runner(fake);
    await runner(fake);

    expect(ran).toEqual(["c3"]);
  });

  it("reports a failure once, for the range since the last tip that passed", async () => {
    const { fake, reported } = deps({
      c2: { outcome: "failed", stage: "End-to-end Run" },
    });
    await request("c1", "c0");
    await runner(fake);
    await request("c2", "c1b");
    await runner(fake);
    await runner(fake);

    expect(reported).toEqual([{ range: "c1..c2", stage: "End-to-end Run" }]);
    expect(await records()).toMatchObject([
      { commit: "c1", range: "c0..c1", result: { outcome: "passed" } },
      {
        commit: "c2",
        issue: "https://github.com/owner/repo/issues/1",
        result: { outcome: "failed" },
      },
    ]);
  });

  it("records a skip on a machine with no desktop, and opens no issue", async () => {
    const { fake, reported } = deps({
      c1: { outcome: "skipped", reason: "no desktop" },
    });
    await request("c1");

    await runner(fake);

    expect(reported).toEqual([]);
    expect(await records()).toMatchObject([
      { commit: "c1", result: { outcome: "skipped", reason: "no desktop" } },
    ]);
  });
});

describe("githubRepository", () => {
  it.each([
    ["git@github.com:aidenlx/zotlit-repo.git", "aidenlx/zotlit-repo"],
    ["https://github.com/aidenlx/zotlit-repo", "aidenlx/zotlit-repo"],
    ["/srv/git/zotlit.git", undefined],
  ])("reads %s", (url, expected) => {
    expect(githubRepository(url)).toBe(expected);
  });
});
