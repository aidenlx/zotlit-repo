import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { git, makeGitRepos } from "./__fixtures__/git-repos.ts";
import type { GitRepos } from "./__fixtures__/git-repos.ts";
import { landAdmission, landWaitLog } from "./land-queue.ts";
import type { LandWaitRecord } from "./land-queue.ts";
import { land, LAND_CI_CHECK, LAND_RECORD_PATH } from "./land.ts";
import type { CiCheck, LandGitHub, LandOptions } from "./land.ts";

// Lands run real Git against a bare origin in a temporary folder, with a gate
// command in place of `pnpm verify`.
const SLOW = 30_000;

let repos: GitRepos;
const spawned = new Set<ChildProcess>();
/** What the children wrote to stderr, for a failure message. */
const output: string[] = [];
beforeEach(async () => {
  repos = await makeGitRepos();
});
afterEach(async () => {
  for (const each of spawned) {
    if (each.exitCode === null && each.signalCode === null)
      each.kill("SIGKILL");
  }
  spawned.clear();
  output.length = 0;
  await repos.dispose();
});

const quiet = { say: () => {}, pollMs: 20 } satisfies Partial<LandOptions>;

/** A clone on branch `branch` with one commit of its own. */
async function taskClone(name: string, branch = `feat/${name}`) {
  const cwd = await repos.clone(name);
  await git(cwd, "switch", "-q", "-c", branch);
  await repos.commit(cwd, `${name}.txt`, { text: `${name}\n`, message: name });
  return cwd;
}

/** A commit on origin's main, made from a clone of its own. */
async function moveMain(file: string, text: string, message = `main ${file}`) {
  const other = await repos.clone(`main-${file}-${Math.random()}`);
  const sha = await repos.commit(other, file, { text, message });
  await git(other, "push", "-q", "origin", "HEAD:refs/heads/main");
  return sha;
}

const subjects = async (ref: string) =>
  (await git(repos.remote, "log", "--format=%s", ref)).split("\n");

async function waits(): Promise<LandWaitRecord[]> {
  const text = await readFile(landWaitLog(), "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LandWaitRecord);
}

async function until(check: () => Promise<boolean>, what: string) {
  for (let tries = 0; tries < 500; tries++) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${what}\n${output.join("")}`);
}

describe("land", () => {
  it(
    "rebases onto the moved main, gates the rebased tree, and pushes it",
    async () => {
      const cwd = await taskClone("a");
      await git(cwd, "push", "-q", "origin", "HEAD");
      await moveMain("upstream.txt", "upstream\n");

      const result = await land({
        ...quiet,
        cwd,
        // The gate sees the commit that main gained after the branch left it.
        gate: ["sh", "-c", "test -e upstream.txt && test -e a.txt"],
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      expect(await subjects("main")).toEqual([
        "a",
        "main upstream.txt",
        "seed",
      ]);
      expect(await git(cwd, "rev-parse", "HEAD")).toBe(
        await git(repos.remote, "rev-parse", "main"),
      );
      // The local main follows, and the task branch is gone on origin.
      expect(await git(cwd, "rev-parse", "main")).toBe(
        await git(cwd, "rev-parse", "HEAD"),
      );
      expect(await git(repos.remote, "branch", "--list", "feat/a")).toBe("");
      expect(await waits()).toMatchObject([
        { source: "feat/a", outcome: "landed", attempts: 1 },
      ]);
    },
    SLOW,
  );

  it(
    "on a rebase conflict, leaves the branch as it was and main unchanged",
    async () => {
      const cwd = await repos.clone("a");
      await git(cwd, "switch", "-q", "-c", "feat/a");
      const original = await repos.commit(cwd, "README.md", {
        text: "branch\n",
      });
      const upstream = await moveMain("README.md", "upstream\n");

      const result = await land({ ...quiet, cwd, gate: ["true"] });

      expect(result).toMatchObject({ ok: false, step: "rebase", exitCode: 1 });
      expect(result.ok || result.message).toContain("README.md");
      expect(await git(cwd, "rev-parse", "HEAD")).toBe(original);
      expect(await git(cwd, "symbolic-ref", "--short", "HEAD")).toBe("feat/a");
      expect(await git(cwd, "status", "--porcelain")).toBe("");
      expect(existsSync(join(cwd, ".git", "rebase-merge"))).toBe(false);
      expect(await git(repos.remote, "rev-parse", "main")).toBe(upstream);
    },
    SLOW,
  );

  it(
    "starts again from the fetch, in the same turn, when main moved during the gate",
    async () => {
      const cwd = await taskClone("a");
      const other = await repos.clone("other");
      const marker = join(repos.root, "moved");
      // The first gate run lands another change on main before the push.
      const gate = [
        `if [ ! -e '${marker}' ]; then`,
        `  touch '${marker}' && cd '${other}' &&`,
        "  echo moved > moved.txt && git add moved.txt &&",
        "  git commit -qm moved && git push -q origin HEAD:refs/heads/main",
        "fi",
      ].join("\n");

      const result = await land({
        ...quiet,
        cwd,
        gate: ["sh", "-c", gate],
      });

      expect(result).toMatchObject({ ok: true, attempts: 2 });
      expect(await subjects("main")).toEqual(["a", "moved", "seed"]);
      expect(await waits()).toMatchObject([{ outcome: "landed", attempts: 2 }]);
    },
    SLOW,
  );

  it(
    "on a failed gate, pushes nothing and names the step and the log",
    async () => {
      const cwd = await taskClone("a");
      const upstream = await moveMain("upstream.txt", "upstream\n");

      const result = await land({
        ...quiet,
        cwd,
        gate: ["sh", "-c", "echo the gate says no; exit 3"],
      });

      expect(result).toMatchObject({ ok: false, step: "gate", exitCode: 1 });
      if (result.ok) return;
      expect(await readFile(result.logPath, "utf8")).toContain(
        "the gate says no",
      );
      expect(await git(repos.remote, "rev-parse", "main")).toBe(upstream);
      // The branch stays rebased onto the fetched main: the tree to fix.
      expect(await git(cwd, "symbolic-ref", "--short", "HEAD")).toBe("feat/a");
      expect(await git(cwd, "status", "--porcelain")).toBe("");
      expect(await git(cwd, "rev-parse", "HEAD~1")).toBe(upstream);
      expect(await waits()).toMatchObject([
        { outcome: "failed", step: "gate" },
      ]);
    },
    SLOW,
  );

  it(
    "keeps the Land Turn of a gate that runs longer than its silence limit while it prints",
    async () => {
      const cwd = await taskClone("a");
      const result = await land({
        ...quiet,
        cwd,
        silenceMs: 600,
        gate: [
          "sh",
          "-c",
          "for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo $i; sleep 0.1; done",
        ],
      });
      expect(result).toMatchObject({ ok: true });
    },
    SLOW,
  );

  it(
    "ends the Land Turn of a gate that prints nothing for its silence limit",
    async () => {
      const cwd = await taskClone("a");
      const result = await land({
        ...quiet,
        cwd,
        silenceMs: 500,
        gate: ["sh", "-c", "echo starting; sleep 30"],
      });
      expect(result).toMatchObject({ ok: false, step: "lease" });
      // On a loaded machine the limit can pass before the gate's first line
      // arrives, so the message's last progress is not part of the claim.
      expect(result.ok || result.message).toMatch(
        /made no progress for .*silence limit of 500 ms/,
      );
      expect(await subjects("main")).toEqual(["seed"]);
    },
    SLOW,
  );

  it("refuses a worktree with changes that are not committed", async () => {
    const cwd = await taskClone("a");
    await writeFile(join(cwd, "loose.txt"), "loose\n");

    const result = await land({ ...quiet, cwd, gate: ["true"] });

    expect(result).toMatchObject({ ok: false, step: "preflight" });
  });

  it("refuses an agent branch before the gate, since its push to origin is refused", async () => {
    const cwd = await taskClone("a", "claude/a");
    const marker = join(repos.root, "gated");

    const result = await land({
      ...quiet,
      cwd,
      gate: ["touch", marker],
    });

    expect(result).toMatchObject({ ok: false, step: "preflight" });
    expect(result.ok || result.message).toContain("Rename the branch");
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a detached HEAD, which names no branch to rebase", async () => {
    const cwd = await repos.clone("detached");
    await git(cwd, "switch", "-q", "--detach", "origin/main");

    const result = await land({ ...quiet, cwd, gate: ["true"] });

    expect(result).toMatchObject({ ok: false, step: "preflight" });
  });
});

interface FakePull {
  number: number;
  url: string;
  head: string;
  base: string;
  title: string;
  body: string;
  merged: boolean;
}

/** One read of the CI check of `commit`: the how-many-th read of that commit. */
type CiScript = (read: {
  commit: string;
  count: number;
}) => Promise<CiCheck | undefined> | CiCheck | undefined;

/** A check that passed, as GitHub shows a finished run of the job. */
const passed = (id = 1): CiCheck => ({
  id,
  status: "completed",
  conclusion: "success",
  url: `https://github.com/owner/repo/actions/runs/1/job/${id}`,
  queuedAt: "2026-11-22T10:00:00Z",
  startedAt: "2026-11-22T10:00:20Z",
  completedAt: "2026-11-22T10:05:20Z",
});

/**
 * GitHub over the bare origin: a PR needs its head branch on origin, and it
 * shows as merged once `main` holds the branch's tip, unless `merges` is off.
 * The CI check of each commit follows `ci`, which passes by default.
 */
function fakeGitHub({
  merges = true,
  ci = () => passed(),
}: { merges?: boolean; ci?: CiScript } = {}) {
  const pulls: FakePull[] = [];
  /** Each read of a check, in order. */
  const checkReads: { commit: string; name: string }[] = [];
  const branchTip = (branch: string) =>
    git(repos.remote, "rev-parse", "--verify", `refs/heads/${branch}`);
  const github: LandGitHub = {
    findOpenPullRequest: async ({ head, base }) =>
      pulls.find(
        (pull) => pull.head === head && pull.base === base && !pull.merged,
      ),
    createPullRequest: async ({ head, base, title, body }) => {
      await branchTip(head).catch(() => {
        throw new Error(`Head ref ${head} is not on origin.`);
      });
      const number = pulls.length + 1;
      const pull = {
        number,
        url: `https://github.com/owner/repo/pull/${number}`,
        head,
        base,
        title,
        body,
        merged: false,
      };
      pulls.push(pull);
      return pull;
    },
    editPullRequest: async (number, { title, body }) => {
      const pull = pulls.find((each) => each.number === number)!;
      pull.title = title;
      pull.body = body;
    },
    pullRequestState: async (number) => {
      const pull = pulls.find((each) => each.number === number)!;
      if (!pull.merged && merges) {
        const tip = await branchTip(pull.head);
        pull.merged = await git(
          repos.remote,
          "merge-base",
          "--is-ancestor",
          tip,
          pull.base,
        ).then(
          () => true,
          () => false,
        );
      }
      return pull.merged ? "MERGED" : "OPEN";
    },
    readCheck: async ({ commit, name }) => {
      checkReads.push({ commit, name });
      const count = checkReads.filter((each) => each.commit === commit).length;
      return await ci({ commit, count });
    },
  };
  return { github, pulls, checkReads };
}

const SECTIONS = [
  "Summary",
  "Testing",
  "Risk",
  "How to revert",
  "Review",
  "Open points",
  "e2e",
];

/** Write the record file of the worktree `cwd`, with `sections`. */
async function writeRecord(
  cwd: string,
  { title = "Add a", sections = SECTIONS, text = "Closes #1." } = {},
) {
  const path = join(cwd, LAND_RECORD_PATH);
  await mkdir(join(path, ".."), { recursive: true });
  const body = sections.map((name) => `## ${name}\n\n${text}\n`).join("\n");
  await writeFile(path, `# ${title}\n\n${body}`);
}

describe("the record PR", () => {
  it(
    "opens a PR whose body is the record, pushes main to its head, and deletes the branch once it shows as merged",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const { github, pulls } = fakeGitHub();

      const result = await land({ ...quiet, cwd, gate: ["true"], github });

      expect(result).toMatchObject({
        ok: true,
        record: { url: "https://github.com/owner/repo/pull/1", merged: true },
      });
      expect(pulls).toMatchObject([
        { head: "feat/a", base: "main", title: "Add a", merged: true },
      ]);
      expect(pulls[0]!.body).toMatch(/^## Summary\n\nCloses #1\./);
      expect(pulls[0]!.body).not.toContain("# Add a");
      expect(await git(repos.remote, "rev-parse", "main")).toBe(
        await git(cwd, "rev-parse", "HEAD"),
      );
      expect(await git(repos.remote, "branch", "--list", "feat/a")).toBe("");
    },
    SLOW,
  );

  it(
    "updates the open PR of the branch when it lands again",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd, { text: "first" });
      const { github, pulls } = fakeGitHub();
      const other = await repos.clone("other");
      const marker = join(repos.root, "moved");
      // The first land's gate moves main once, and that land has one attempt.
      const gate = [
        `if [ ! -e '${marker}' ]; then`,
        `  touch '${marker}' && cd '${other}' &&`,
        "  echo moved > moved.txt && git add moved.txt &&",
        "  git commit -qm moved && git push -q origin HEAD:refs/heads/main",
        "fi",
      ].join("\n");

      const first = await land({
        ...quiet,
        cwd,
        gate: ["sh", "-c", gate],
        attempts: 1,
        github,
      });
      expect(first).toMatchObject({ ok: false, step: "push" });
      expect(pulls).toMatchObject([{ merged: false }]);

      await writeRecord(cwd, { title: "Add a, again", text: "second" });
      const second = await land({
        ...quiet,
        cwd,
        gate: ["sh", "-c", gate],
        github,
      });

      expect(second).toMatchObject({ ok: true, record: { merged: true } });
      expect(pulls).toHaveLength(1);
      expect(pulls[0]).toMatchObject({ title: "Add a, again", merged: true });
      expect(pulls[0]!.body).toContain("second");
      expect(await subjects("main")).toEqual(["a", "moved", "seed"]);
    },
    SLOW,
  );

  it.each([
    {
      name: "no record file",
      write: async () => {},
      problem: LAND_RECORD_PATH,
    },
    {
      name: "a record without a Review section",
      write: (cwd: string) =>
        writeRecord(cwd, {
          sections: SECTIONS.filter((name) => name !== "Review"),
        }),
      problem: "Review",
    },
  ])(
    "refuses $name before it pushes anything",
    async ({ write, problem }) => {
      const cwd = await taskClone("a");
      await write(cwd);
      const { github, pulls } = fakeGitHub();

      const result = await land({ ...quiet, cwd, gate: ["true"], github });

      expect(result).toMatchObject({ ok: false, step: "preflight" });
      expect(result.ok || result.message).toContain(problem);
      expect(pulls).toEqual([]);
      expect(await git(repos.remote, "branch", "--list")).toBe("* main");
    },
    SLOW,
  );

  it(
    "fails at the record step, with main unchanged, when GitHub refuses the PR",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const { github } = fakeGitHub();
      github.createPullRequest = async () => {
        throw new Error("HTTP 422: Validation Failed");
      };

      const result = await land({ ...quiet, cwd, gate: ["true"], github });

      expect(result).toMatchObject({ ok: false, step: "record" });
      expect(result.ok || result.message).toContain("Validation Failed");
      expect(await subjects("main")).toEqual(["seed"]);
      expect(await git(repos.remote, "rev-parse", "feat/a")).toBe(
        await git(cwd, "rev-parse", "HEAD"),
      );
    },
    SLOW,
  );

  it(
    "refuses a land whose GitHub login fails a read, before the gate runs",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const { github, pulls } = fakeGitHub();
      github.findOpenPullRequest = async () => {
        throw new Error("HTTP 401: Bad credentials");
      };
      const marker = join(repos.root, "gate-ran");

      const result = await land({
        ...quiet,
        cwd,
        gate: ["touch", marker],
        github,
      });

      expect(result).toMatchObject({ ok: false, step: "preflight" });
      expect(result.ok || result.message).toContain("Bad credentials");
      expect(existsSync(marker)).toBe(false);
      expect(pulls).toEqual([]);
      expect(await git(repos.remote, "branch", "--list")).toBe("* main");
    },
    SLOW,
  );

  it.each([
    { name: "does not show the PR as merged", reads: "OPEN" },
    { name: "cannot be read", reads: "an error" },
  ])(
    "keeps the branch and says so when GitHub $name after main moved",
    async ({ reads }) => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const { github } = fakeGitHub({ merges: false });
      if (reads === "an error") {
        github.pullRequestState = async () => {
          throw new Error("HTTP 502");
        };
      }
      const lines: string[] = [];

      const result = await land({
        ...quiet,
        say: (line) => lines.push(line),
        cwd,
        gate: ["true"],
        github,
      });

      expect(result).toMatchObject({ ok: true, record: { merged: false } });
      expect(await git(repos.remote, "rev-parse", "main")).toBe(
        await git(cwd, "rev-parse", "HEAD"),
      );
      expect(await git(repos.remote, "branch", "--list", "feat/a")).toContain(
        "feat/a",
      );
      expect(lines.join("\n")).toContain(
        "https://github.com/owner/repo/pull/1 does not show as merged",
      );
    },
    SLOW,
  );
});

describe("the CI check of the record PR", () => {
  const fast = { ...quiet, ciPollMs: 20 } satisfies Partial<LandOptions>;
  const failed = (id = 1): CiCheck => ({
    ...passed(id),
    conclusion: "failure",
  });

  it(
    "waits for the check of the PR head, printing its state, and pushes main when it passes",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const seed = await git(repos.remote, "rev-parse", "main");
      /** origin's main at each read while the check runs. */
      const mainWhilePending: string[] = [];
      const { github, checkReads } = fakeGitHub({
        ci: async ({ count }) => {
          if (count === 1) return undefined;
          if (count <= 3) {
            mainWhilePending.push(await git(repos.remote, "rev-parse", "main"));
            return {
              ...passed(),
              status: count === 2 ? "queued" : "in_progress",
              conclusion: null,
            };
          }
          return passed();
        },
      });
      const lines: string[] = [];

      const result = await land({
        ...fast,
        say: (line) => lines.push(line),
        cwd,
        gate: ["true"],
        github,
      });

      expect(result).toMatchObject({ ok: true });
      const head = await git(cwd, "rev-parse", "HEAD");
      expect(await git(repos.remote, "rev-parse", "main")).toBe(head);
      expect(checkReads).toHaveLength(4);
      expect(checkReads.every((read) => read.commit === head)).toBe(true);
      expect(checkReads[0]!.name).toBe(LAND_CI_CHECK);
      expect(mainWhilePending).toEqual([seed, seed]);
      const printed = lines.join("\n");
      expect(printed).toMatch(/CI .*queued/);
      expect(printed).toMatch(/CI .*in progress/);
      // The time the job waited for a runner goes to the wait log.
      expect(await waits()).toMatchObject([
        {
          outcome: "landed",
          ci: [{ conclusion: "success", queueMs: 20_000, runMs: 300_000 }],
        },
      ]);
    },
    SLOW,
  );

  it(
    "fails with the job and its link when the check fails, and leaves main as it was",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const seed = await git(repos.remote, "rev-parse", "main");
      const { github } = fakeGitHub({ ci: () => failed(7) });

      const result = await land({ ...fast, cwd, gate: ["true"], github });

      expect(result).toMatchObject({ ok: false, step: "ci", exitCode: 1 });
      expect(result.ok || result.message).toContain(LAND_CI_CHECK);
      expect(result.ok || result.message).toContain(
        "https://github.com/owner/repo/actions/runs/1/job/7",
      );
      expect(await git(repos.remote, "rev-parse", "main")).toBe(seed);
      // The PR head stays on origin, so the PR shows the failed check.
      expect(await git(repos.remote, "rev-parse", "feat/a")).toBe(
        await git(cwd, "rev-parse", "HEAD"),
      );
      expect(await waits()).toMatchObject([
        { outcome: "failed", step: "ci", ci: [{ conclusion: "failure" }] },
      ]);
    },
    SLOW,
  );

  it(
    "keeps the Land Turn while the check runs longer than the silence limit",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const started = Temporal.Now.instant().epochMilliseconds;
      const { github } = fakeGitHub({
        ci: () =>
          Temporal.Now.instant().epochMilliseconds - started < 1_500
            ? { ...passed(), status: "in_progress", conclusion: null }
            : passed(),
      });

      const result = await land({
        ...fast,
        silenceMs: 500,
        cwd,
        gate: ["true"],
        github,
      });

      expect(result).toMatchObject({ ok: true });
    },
    SLOW,
  );

  it(
    "fails when no check shows for the PR head within the CI wait",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const { github } = fakeGitHub({ ci: () => undefined });

      const result = await land({
        ...fast,
        ciWaitMs: 200,
        cwd,
        gate: ["true"],
        github,
      });

      expect(result).toMatchObject({ ok: false, step: "ci" });
      expect(result.ok || result.message).toContain(
        `no "${LAND_CI_CHECK}" check`,
      );
      expect(await subjects("main")).toEqual(["seed"]);
    },
    SLOW,
  );

  it(
    "waits again on the new head when main moved while the check ran",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      let moved = false;
      const { github, checkReads } = fakeGitHub({
        ci: async () => {
          if (!moved) {
            moved = true;
            await moveMain("moved.txt", "moved\n", "moved");
          }
          return passed();
        },
      });

      const result = await land({ ...fast, cwd, gate: ["true"], github });

      expect(result).toMatchObject({ ok: true, attempts: 2 });
      expect(await subjects("main")).toEqual(["a", "moved", "seed"]);
      const commits = [...new Set(checkReads.map((read) => read.commit))];
      expect(commits).toHaveLength(2);
      expect(commits[1]).toBe(await git(repos.remote, "rev-parse", "main"));
    },
    SLOW,
  );
});

describe("the Land Queue", () => {
  const MODULE = new URL("./land.ts", import.meta.url).href;
  const QUEUE = new URL("./land-queue.ts", import.meta.url).href;
  const SLOT = new URL("./desktop-slot.ts", import.meta.url).href;

  function child(code: string): ChildProcess {
    const each = spawn(process.execPath, ["--input-type=module", "-e", code], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    spawned.add(each);
    each.stderr.on("data", (chunk: Buffer) => output.push(String(chunk)));
    return each;
  }

  /** A child that lands `cwd` and prints its result. */
  function landChild(cwd: string): ChildProcess {
    return child(
      `const { land } = await import(${JSON.stringify(MODULE)});
const result = await land({ cwd: ${JSON.stringify(cwd)}, gate: ["true"], pollMs: 20, say: () => {} });
console.log(JSON.stringify(result));`,
    );
  }

  async function tickets(): Promise<number> {
    const dir = join(landAdmission().dir(), "queue");
    return (await readdir(dir).catch(() => [])).filter((name) =>
      name.endsWith(".json"),
    ).length;
  }

  it(
    "lands in the order the lands joined the queue",
    async () => {
      // A holder keeps the turn until its stdin closes.
      const holder = child(
        `const slot = await import(${JSON.stringify(SLOT)});
const { landAdmission } = await import(${JSON.stringify(QUEUE)});
const held = await slot.acquireDesktopSlot({ admission: landAdmission(), silenceMs: 600000, pollMs: 20, log: () => {} });
console.log("held");
process.stdin.resume();
process.stdin.on("end", () => { held.release(); process.exit(0); });`,
      );
      await once(holder.stdout!, "data");
      const first = landChild(await taskClone("a"));
      await until(async () => (await tickets()) === 1, "the first ticket");
      const second = landChild(await taskClone("b"));
      await until(async () => (await tickets()) === 2, "the second ticket");

      holder.stdin!.end();
      const exits = await Promise.all([
        once(first, "exit"),
        once(second, "exit"),
      ]);

      expect(exits).toEqual([
        [0, null],
        [0, null],
      ]);
      expect(await subjects("main")).toEqual(["b", "a", "seed"]);
      const [a, b] = await waits();
      expect(a).toMatchObject({ source: "feat/a", outcome: "landed" });
      expect(b).toMatchObject({ source: "feat/b", outcome: "landed" });
      expect(b!.waitMs).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "takes the turn over from a holder that died",
    async () => {
      const dead = child("process.exit(0)");
      await once(dead, "exit");
      const slot = join(landAdmission().dir(), "slot-0");
      await mkdir(slot, { recursive: true });
      const now = Temporal.Now.instant();
      await writeFile(
        join(slot, "owner.json"),
        JSON.stringify({
          token: "dead-holder",
          pid: dead.pid,
          command: "land feat/dead into main",
          worktree: join(repos.root, "dead"),
          enqueuedAt: now.toString(),
          deadline: now.toString(),
          slots: [0],
          admittedAt: now.toString(),
          lease: 3_600_000,
          leaseEndsAt: now.add({ hours: 1 }).toString(),
        }),
      );
      const lines: string[] = [];

      const result = await land({
        ...quiet,
        say: (line) => lines.push(line),
        cwd: await taskClone("a"),
        gate: ["true"],
      });

      expect(result).toMatchObject({ ok: true });
      expect(lines.join("\n")).toContain(`pid ${dead.pid}`);
      expect(await subjects("main")).toEqual(["a", "seed"]);
    },
    SLOW,
  );
});
