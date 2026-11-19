import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DesktopPaint } from "./desktop-paint.ts";
import {
  githubRepository,
  readLandE2eRecords,
  requestLandE2e,
  runLandE2e,
} from "./land-e2e.ts";
import type { LandE2eDeps, LandE2eOutcome } from "./land-e2e.ts";

// The runner's run, report, and paint probe are the process, network, and OS
// boundaries: the real ones check out, bootstrap, drive the desktop, call
// `gh`, and ask macOS whether the desktop can paint.
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

const PAINTS: DesktopPaint = { state: "paints" };
const LID_CLOSED: DesktopPaint = {
  state: "cannot paint",
  machine: "no display is awake (Color LCD: asleep), and the screen is locked",
};

/**
 * Fakes of the runner's boundaries. `paints` answers the probes in order;
 * the last answer repeats.
 */
function deps(
  outcomes: Record<string, LandE2eOutcome> = {},
  paints: DesktopPaint[] = [PAINTS],
) {
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
    paint: () =>
      Promise.resolve(paints.length > 1 ? paints.shift()! : paints[0]!),
  };
  return { fake, ran, reported };
}

const runner = (fake: LandE2eDeps) =>
  runLandE2e(fake, { dir, pollMs: 10, log: () => {} });

const records = () => readLandE2eRecords(100, dir);

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

describe("the End-to-end Run after a land on a desktop that cannot paint", () => {
  it("records the tip as not run with the machine state, opens no issue, and runs the newer tip next", async () => {
    const { fake, ran, reported } = deps({}, [PAINTS, LID_CLOSED, PAINTS]);
    await request("c0");
    await runner(fake);
    await request("c1", "c0");
    await runner(fake);
    await request("c2", "c1");
    await runner(fake);

    expect(ran).toEqual(["c0", "c2"]);
    expect(reported).toEqual([]);
    expect(await records()).toMatchObject([
      { commit: "c0", result: { outcome: "passed" } },
      {
        commit: "c1",
        result: {
          outcome: "not-run",
          reason: `the desktop cannot paint a window: ${LID_CLOSED.machine}`,
        },
      },
      // The range of the newer tip starts at the last tip that passed, so it
      // holds the commits of the tip that did not run.
      { commit: "c2", range: "c0..c2", result: { outcome: "passed" } },
    ]);
  });

  it("records a failed run as not run when the desktop stopped painting during it", async () => {
    const { fake, ran, reported } = deps(
      { c1: { outcome: "failed", stage: "End-to-end Run" } },
      [PAINTS, LID_CLOSED],
    );
    await request("c1");

    await runner(fake);

    expect(ran).toEqual(["c1"]);
    expect(reported).toEqual([]);
    expect(await records()).toMatchObject([
      {
        commit: "c1",
        result: {
          outcome: "not-run",
          reason: `the desktop stopped painting during the run: ${LID_CLOSED.machine}`,
        },
      },
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
