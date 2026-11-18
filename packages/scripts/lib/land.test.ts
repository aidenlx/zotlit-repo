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
import { land } from "./land.ts";
import type { LandOptions } from "./land.ts";

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

/** A commit on origin's next, made from a clone of its own. */
async function moveNext(file: string, text: string, message = `next ${file}`) {
  const other = await repos.clone(`next-${file}-${Math.random()}`);
  const sha = await repos.commit(other, file, { text, message });
  await git(other, "push", "-q", "origin", "HEAD:refs/heads/next");
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

describe("land into next", () => {
  it(
    "rebases onto the moved next, gates the rebased tree, and pushes it",
    async () => {
      const cwd = await taskClone("a");
      await git(cwd, "push", "-q", "origin", "HEAD");
      await moveNext("upstream.txt", "upstream\n");

      const result = await land({
        ...quiet,
        cwd,
        to: "next",
        // The gate sees the commit that next gained after the branch left it.
        gate: ["sh", "-c", "test -e upstream.txt && test -e a.txt"],
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      expect(await subjects("next")).toEqual([
        "a",
        "next upstream.txt",
        "seed",
      ]);
      expect(await git(cwd, "rev-parse", "HEAD")).toBe(
        await git(repos.remote, "rev-parse", "next"),
      );
      // The local next follows, and the task branch is gone on origin.
      expect(await git(cwd, "rev-parse", "next")).toBe(
        await git(cwd, "rev-parse", "HEAD"),
      );
      expect(await git(repos.remote, "branch", "--list", "feat/a")).toBe("");
      expect(await waits()).toMatchObject([
        { target: "next", source: "feat/a", outcome: "landed", attempts: 1 },
      ]);
    },
    SLOW,
  );

  it(
    "on a rebase conflict, leaves the branch as it was and next unchanged",
    async () => {
      const cwd = await repos.clone("a");
      await git(cwd, "switch", "-q", "-c", "feat/a");
      const original = await repos.commit(cwd, "README.md", {
        text: "branch\n",
      });
      const upstream = await moveNext("README.md", "upstream\n");

      const result = await land({ ...quiet, cwd, to: "next", gate: ["true"] });

      expect(result).toMatchObject({ ok: false, step: "rebase", exitCode: 1 });
      expect(result.ok || result.message).toContain("README.md");
      expect(await git(cwd, "rev-parse", "HEAD")).toBe(original);
      expect(await git(cwd, "symbolic-ref", "--short", "HEAD")).toBe("feat/a");
      expect(await git(cwd, "status", "--porcelain")).toBe("");
      expect(existsSync(join(cwd, ".git", "rebase-merge"))).toBe(false);
      expect(await git(repos.remote, "rev-parse", "next")).toBe(upstream);
    },
    SLOW,
  );

  it(
    "starts again from the fetch, in the same turn, when next moved during the gate",
    async () => {
      const cwd = await taskClone("a");
      const other = await repos.clone("other");
      const marker = join(repos.root, "moved");
      // The first gate run lands another change on next before the push.
      const gate = [
        `if [ ! -e '${marker}' ]; then`,
        `  touch '${marker}' && cd '${other}' &&`,
        "  echo moved > moved.txt && git add moved.txt &&",
        "  git commit -qm moved && git push -q origin HEAD:refs/heads/next",
        "fi",
      ].join("\n");

      const result = await land({
        ...quiet,
        cwd,
        to: "next",
        gate: ["sh", "-c", gate],
      });

      expect(result).toMatchObject({ ok: true, attempts: 2 });
      expect(await subjects("next")).toEqual(["a", "moved", "seed"]);
      expect(await waits()).toMatchObject([{ outcome: "landed", attempts: 2 }]);
    },
    SLOW,
  );

  it(
    "on a failed gate, pushes nothing and names the step and the log",
    async () => {
      const cwd = await taskClone("a");
      const upstream = await moveNext("upstream.txt", "upstream\n");

      const result = await land({
        ...quiet,
        cwd,
        to: "next",
        gate: ["sh", "-c", "echo the gate says no; exit 3"],
      });

      expect(result).toMatchObject({ ok: false, step: "gate", exitCode: 1 });
      if (result.ok) return;
      expect(await readFile(result.logPath, "utf8")).toContain(
        "the gate says no",
      );
      expect(await git(repos.remote, "rev-parse", "next")).toBe(upstream);
      // The branch stays rebased onto the fetched next: the tree to fix.
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
        to: "next",
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
        to: "next",
        silenceMs: 500,
        gate: ["sh", "-c", "echo starting; sleep 30"],
      });
      expect(result).toMatchObject({ ok: false, step: "lease" });
      expect(result.ok || result.message).toMatch(
        /made no progress for .*silence limit of 500 ms.*"output of sh -c"/,
      );
      expect(await subjects("next")).toEqual(["seed"]);
    },
    SLOW,
  );

  it("refuses a worktree with changes that are not committed", async () => {
    const cwd = await taskClone("a");
    await writeFile(join(cwd, "loose.txt"), "loose\n");

    const result = await land({ ...quiet, cwd, to: "next", gate: ["true"] });

    expect(result).toMatchObject({ ok: false, step: "preflight" });
  });
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
const result = await land({ cwd: ${JSON.stringify(cwd)}, to: "next", gate: ["true"], pollMs: 20, say: () => {} });
console.log(JSON.stringify(result));`,
    );
  }

  async function tickets(): Promise<number> {
    const dir = join(landAdmission("next").dir(), "queue");
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
const held = await slot.acquireDesktopSlot({ admission: landAdmission("next"), silenceMs: 600000, pollMs: 20, log: () => {} });
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
      expect(await subjects("next")).toEqual(["b", "a", "seed"]);
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
      const slot = join(landAdmission("next").dir(), "slot-0");
      await mkdir(slot, { recursive: true });
      const now = Temporal.Now.instant();
      await writeFile(
        join(slot, "owner.json"),
        JSON.stringify({
          token: "dead-holder",
          pid: dead.pid,
          command: "land feat/dead into next",
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
        to: "next",
        gate: ["true"],
      });

      expect(result).toMatchObject({ ok: true });
      expect(lines.join("\n")).toContain(`pid ${dead.pid}`);
      expect(await subjects("next")).toEqual(["a", "seed"]);
    },
    SLOW,
  );
});

describe("land into main", () => {
  it(
    "fast-forwards main to a commit of next after the gate",
    async () => {
      const seed = join(repos.root, "seed");
      await git(seed, "push", "-q", "origin", "HEAD:refs/heads/main");
      const tip = await moveNext("feature.txt", "feature\n");
      const cwd = await repos.clone("release");
      await git(cwd, "switch", "-q", "--detach", "origin/next");

      const result = await land({ ...quiet, cwd, to: "main", gate: ["true"] });

      expect(result).toMatchObject({ ok: true, commit: tip });
      expect(await git(repos.remote, "rev-parse", "main")).toBe(tip);
    },
    SLOW,
  );

  it(
    "refuses a commit that next does not have",
    async () => {
      const seed = join(repos.root, "seed");
      await git(seed, "push", "-q", "origin", "HEAD:refs/heads/main");
      const cwd = await repos.clone("release");
      await git(cwd, "switch", "-q", "--detach");
      await repos.commit(cwd, "local.txt", { text: "local\n" });

      const result = await land({ ...quiet, cwd, to: "main", gate: ["true"] });

      expect(result).toMatchObject({ ok: false, step: "check" });
      expect(await git(repos.remote, "rev-parse", "main")).toBe(
        await git(seed, "rev-parse", "HEAD"),
      );
    },
    SLOW,
  );
});
