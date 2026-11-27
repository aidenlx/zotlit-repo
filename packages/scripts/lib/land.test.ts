import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { git, makeGitRepos } from "./__fixtures__/git-repos.ts";
import type { GitRepos } from "./__fixtures__/git-repos.ts";
import { landAdmission, landStateDir, landWaitLog } from "./land-queue.ts";
import type { LandWaitRecord } from "./land-queue.ts";
import {
  land,
  LAND_AFTER_CI_MARKER,
  LAND_CI_CHECK,
  LAND_PR_PATH,
  LAND_RECORD_PATH,
  LAND_WORKFLOW,
} from "./land.ts";
import type { CiCheck, LandGitHub, LandOptions } from "./land.ts";

const SLOW = 30_000;

let repos: GitRepos;
const spawned = new Set<ChildProcess>();
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

const quiet = {
  say: () => {},
  pollMs: 20,
  mergedWaitMs: 100,
  mergedPollMs: 10,
} satisfies Partial<LandOptions>;

async function taskClone(name: string, branch = `feat/${name}`) {
  const cwd = await repos.clone(name);
  await git(cwd, "switch", "-q", "-c", branch);
  await repos.commit(cwd, `${name}.txt`, {
    text: `${name}\n`,
    message: `feat: ${name}`,
  });
  return cwd;
}

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
        gate: ["sh", "-c", "test -e upstream.txt && test -e a.txt"],
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      expect(await subjects("main")).toEqual([
        "feat: a",
        "main upstream.txt",
        "seed",
      ]);
      expect(await git(cwd, "rev-parse", "HEAD")).toBe(
        await git(repos.remote, "rev-parse", "main"),
      );
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
        message: "fix: branch README",
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
      expect(await subjects("main")).toEqual(["feat: a", "moved", "seed"]);
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
    "skips the gate step of a land without a gate, and pushes the rebased tree",
    async () => {
      const cwd = await taskClone("a");
      await moveMain("upstream.txt", "upstream\n");

      const result = await land({ ...quiet, cwd });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      if (!result.ok) return;
      expect(await readFile(result.logPath, "utf8")).not.toContain("▸ gate");
      expect(await subjects("main")).toEqual([
        "feat: a",
        "main upstream.txt",
        "seed",
      ]);
    },
    SLOW,
  );

  it(
    "installs the dependencies before the gate when the rebase brings a new lockfile",
    async () => {
      const cwd = await taskClone("a");
      await moveMain("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
      const installed = join(repos.root, "installed");

      const result = await land({
        ...quiet,
        cwd,
        install: ["touch", installed],
        gate: ["test", "-e", installed],
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      if (!result.ok) return;
      expect(await readFile(result.logPath, "utf8")).toMatch(
        /▸ rebase[\s\S]*▸ install[\s\S]*▸ gate/,
      );
    },
    SLOW,
  );

  it(
    "runs no install when the rebase leaves the dependency files as they were",
    async () => {
      const cwd = await taskClone("a");
      await moveMain("upstream.txt", "upstream\n");
      const installed = join(repos.root, "installed");

      const result = await land({
        ...quiet,
        cwd,
        install: ["touch", installed],
        gate: ["true"],
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      if (!result.ok) return;
      expect(existsSync(installed)).toBe(false);
      expect(await readFile(result.logPath, "utf8")).not.toContain("▸ install");
    },
    SLOW,
  );

  it(
    "on a failed install, stops before the gate and leaves the branch rebased",
    async () => {
      const cwd = await taskClone("a");
      const upstream = await moveMain("package.json", "{}\n");
      const gated = join(repos.root, "gated");

      const result = await land({
        ...quiet,
        cwd,
        install: ["sh", "-c", "echo the install says no; exit 1"],
        gate: ["touch", gated],
      });

      expect(result).toMatchObject({ ok: false, step: "install", exitCode: 1 });
      if (result.ok) return;
      expect(await readFile(result.logPath, "utf8")).toContain(
        "the install says no",
      );
      expect(existsSync(gated)).toBe(false);
      expect(await git(repos.remote, "rev-parse", "main")).toBe(upstream);
      expect(await git(cwd, "symbolic-ref", "--short", "HEAD")).toBe("feat/a");
      expect(await git(cwd, "status", "--porcelain")).toBe("");
      expect(await git(cwd, "rev-parse", "HEAD~1")).toBe(upstream);
      expect(await waits()).toMatchObject([
        { outcome: "failed", step: "install" },
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

  it("refuses a --no-squash land with a commit subject that is not a Conventional Commits subject", async () => {
    const cwd = await taskClone("a");
    const bad = await repos.commit(cwd, "b.txt", {
      text: "b\n",
      message: "Add b",
    });
    const marker = join(repos.root, "gated");

    const result = await land({
      ...quiet,
      cwd,
      squash: false,
      gate: ["touch", marker],
    });

    expect(result).toMatchObject({ ok: false, step: "preflight" });
    expect(result.ok || result.message).toContain(`${bad.slice(0, 7)} Add b`);
    expect(result.ok || result.message).not.toContain("feat: a");
    expect(existsSync(marker)).toBe(false);
  });

  it(
    "lands --no-squash past a merge commit, which the rebase drops",
    async () => {
      const cwd = await taskClone("a");
      await moveMain("upstream.txt", "upstream\n");
      await git(cwd, "fetch", "-q", "origin");
      await git(cwd, "merge", "-q", "--no-ff", "--no-edit", "origin/main");

      const result = await land({ ...quiet, cwd, squash: false });

      expect(result).toMatchObject({ ok: true });
      expect(await subjects("main")).toEqual([
        "feat: a",
        "main upstream.txt",
        "seed",
      ]);
    },
    SLOW,
  );

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
  draft: boolean;
  merged: boolean;
}

type CiScript = (read: {
  commit: string;
  count: number;
}) => Promise<CiCheck | undefined> | CiCheck | undefined;

const passed = (id = 1): CiCheck => ({
  id,
  status: "completed",
  conclusion: "success",
  url: `https://github.com/owner/repo/actions/runs/1/job/${id}`,
  queuedAt: "2026-11-22T10:00:00Z",
  startedAt: "2026-11-22T10:00:20Z",
  completedAt: "2026-11-22T10:05:20Z",
});

function fakeGitHub({
  merges = true,
  ci = () => passed(),
}: { merges?: boolean; ci?: CiScript } = {}) {
  const pulls: FakePull[] = [];
  const checkReads: { commit: string; name: string }[] = [];
  const branchTip = (branch: string) =>
    git(repos.remote, "rev-parse", "--verify", `refs/heads/${branch}`);
  const github: LandGitHub = {
    advanceMain: async ({ head, base }) => {
      await git(repos.remote, "update-ref", "refs/heads/main", head, base);
    },
    findOpenPullRequest: async ({ head, base }) =>
      pulls.find(
        (pull) => pull.head === head && pull.base === base && !pull.merged,
      ),
    createPullRequest: async ({ head, base, title, body, draft }) => {
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
        draft,
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
    setDraft: async (number, draft) => {
      pulls.find((each) => each.number === number)!.draft = draft;
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

async function writeRecord(
  cwd: string,
  { title = "feat: add a", sections = SECTIONS, text = "Closes #1." } = {},
) {
  const path = join(cwd, LAND_RECORD_PATH);
  await mkdir(join(path, ".."), { recursive: true });
  const body = sections.map((name) => `## ${name}\n\n${text}\n`).join("\n");
  await writeFile(path, `# ${title}\n\n${body}`);
}

describe("the record PR", () => {
  describe("--after-ci", () => {
    const refused = async () => {
      throw new Error("HTTP 403: Resource not accessible by integration");
    };
    const landSoon = (commit: string) => {
      setTimeout(() => {
        void git(repos.remote, "rev-parse", "main").then((tip) =>
          git(repos.remote, "update-ref", "refs/heads/main", commit, tip),
        );
      }, 50);
    };

    it("keeps the marker of the record PR in the landing workflow", async () => {
      const workflow = await readFile(
        join(import.meta.dirname, "../../..", LAND_WORKFLOW),
        "utf8",
      );
      expect(workflow).toContain(`MARKER: "${LAND_AFTER_CI_MARKER}"`);
    });

    it(
      "marks the PR, leaves the commit unmarked, and waits for the workflow to move main",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd);
        const { github, pulls } = fakeGitHub({
          ci: ({ commit }) => {
            landSoon(commit);
            return passed();
          },
        });
        github.advanceMain = refused;

        const result = await land({
          ...quiet,
          cwd,
          github,
          afterCi: true,
          afterCiPollMs: 10,
        });

        expect(result).toMatchObject({ ok: true, record: { merged: true } });
        expect(pulls[0]!.body).toMatch(
          new RegExp(`\n\n${LAND_AFTER_CI_MARKER}$`),
        );
        const head = await git(repos.remote, "rev-parse", "main");
        expect(head).toBe(await git(cwd, "rev-parse", "HEAD"));
        expect(
          await git(repos.remote, "show", "-s", "--format=%B", head),
        ).not.toContain(LAND_AFTER_CI_MARKER);
      },
      SLOW,
    );

    it(
      "hands the PR to the host when GitHub refuses the write, then lands that PR as it is",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd);
        const { github, pulls } = fakeGitHub({
          ci: ({ commit }) => {
            landSoon(commit);
            return passed();
          },
        });
        const create = github.createPullRequest;
        github.advanceMain = refused;
        github.createPullRequest = refused;
        github.editPullRequest = refused;

        const first = await land({
          ...quiet,
          cwd,
          github,
          afterCi: true,
          afterCiPollMs: 10,
        });

        expect(first).toMatchObject({ ok: false, step: "record" });
        expect(first.ok || first.message).toContain(LAND_PR_PATH);
        const pushed = await git(repos.remote, "rev-parse", "feat/a");
        const [heading, ...rest] = (
          await readFile(join(cwd, LAND_PR_PATH), "utf8")
        ).split("\n");
        expect(heading).toBe("# feat: add a");
        const body = rest.join("\n").trim();
        expect(body).toMatch(new RegExp(`${LAND_AFTER_CI_MARKER}$`));
        await create({
          head: "feat/a",
          base: "main",
          title: "feat: add a",
          body: body.replaceAll("\n", "\r\n"),
          draft: false,
        });

        const second = await land({
          ...quiet,
          cwd,
          github,
          afterCi: true,
          afterCiPollMs: 10,
        });

        expect(second).toMatchObject({ ok: true, record: { merged: true } });
        expect(pulls).toHaveLength(1);
        expect(await git(repos.remote, "rev-parse", "main")).toBe(pushed);
      },
      SLOW,
    );

    it(
      "fails at the push step, with main unchanged, when the workflow does not move main",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd);
        const { github } = fakeGitHub();
        github.advanceMain = refused;

        const result = await land({
          ...quiet,
          cwd,
          github,
          afterCi: true,
          afterCiWaitMs: 100,
          afterCiPollMs: 10,
        });

        expect(result).toMatchObject({ ok: false, step: "push" });
        expect(result.ok || result.message).toContain(LAND_WORKFLOW);
        expect(await subjects("main")).toEqual(["seed"]);
      },
      SLOW,
    );

    it(
      "starts again from the fetch when main moves to another commit",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd);
        let moved = false;
        const { github, checkReads } = fakeGitHub({
          ci: async ({ commit }) => {
            if (moved) landSoon(commit);
            else {
              moved = true;
              await moveMain("m.txt", "m");
            }
            return passed();
          },
        });
        github.advanceMain = refused;

        const result = await land({
          ...quiet,
          cwd,
          github,
          afterCi: true,
          afterCiPollMs: 10,
        });

        expect(result).toMatchObject({ ok: true, attempts: 2 });
        expect(new Set(checkReads.map((read) => read.commit)).size).toBe(2);
        expect(await subjects("main")).toEqual([
          "feat: add a",
          "main m.txt",
          "seed",
        ]);
      },
      SLOW,
    );
  });

  describe("--draft", () => {
    it("is named in the help of pnpm land", async () => {
      const child = spawn(
        process.execPath,
        [join(import.meta.dirname, "../scripts/land.ts"), "--help"],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      const help = await text(child.stdout);
      await once(child, "close");

      expect(help).toContain("[--draft]");
      expect(help).toMatch(/--draft\s+open the record PR as a draft/);
    });

    it(
      "gates the squashed branch, pushes it, opens a draft PR, and leaves main as it was",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd);
        const { github, pulls, checkReads } = fakeGitHub();
        const gated = join(repos.root, "gated");
        const lines: string[] = [];

        const result = await land({
          ...quiet,
          say: (line) => lines.push(line),
          cwd,
          gate: ["touch", gated],
          github,
          draft: true,
        });

        expect(result).toMatchObject({ ok: true, draft: true });
        expect(existsSync(gated)).toBe(true);
        expect(pulls).toMatchObject([
          { head: "feat/a", title: "feat: add a", draft: true, merged: false },
        ]);
        expect(await subjects("main")).toEqual(["seed"]);
        expect(await git(repos.remote, "rev-parse", "feat/a")).toBe(
          await git(cwd, "rev-parse", "HEAD"),
        );
        expect(await subjects("feat/a")).toEqual(["feat: add a", "seed"]);
        expect(checkReads).toEqual([]);
        expect(lines.at(-1)).toBe(
          "Draft record PR: https://github.com/owner/repo/pull/1. main is unchanged.",
        );
      },
      SLOW,
    );

    it(
      "updates the same draft PR from the record when it runs again",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd, { text: "first" });
        const { github, pulls } = fakeGitHub();
        await land({ ...quiet, cwd, gate: ["true"], github, draft: true });
        await moveMain("m.txt", "m");
        await writeRecord(cwd, { text: "second" });

        const second = await land({
          ...quiet,
          cwd,
          gate: ["true"],
          github,
          draft: true,
        });

        expect(second).toMatchObject({ ok: true, draft: true });
        expect(pulls).toHaveLength(1);
        expect(pulls[0]).toMatchObject({ draft: true, merged: false });
        expect(pulls[0]!.body).toContain("second");
        expect(await subjects("feat/a")).toEqual([
          "feat: add a",
          "main m.txt",
          "seed",
        ]);
        expect(await subjects("main")).toEqual(["main m.txt", "seed"]);
      },
      SLOW,
    );

    it(
      "lets a plain land mark the draft PR ready and land it",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd);
        const { github, pulls } = fakeGitHub();
        await land({ ...quiet, cwd, gate: ["true"], github, draft: true });

        const result = await land({ ...quiet, cwd, gate: ["true"], github });

        expect(result).toMatchObject({ ok: true, record: { merged: true } });
        expect(result.ok && result.draft).toBeFalsy();
        expect(pulls).toMatchObject([
          { number: 1, draft: false, merged: true },
        ]);
        expect(await git(repos.remote, "rev-parse", "main")).toBe(
          await git(cwd, "rev-parse", "HEAD"),
        );
      },
      SLOW,
    );

    it(
      "passes the pre-push hook of an agent session with the task branch alone",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd);
        const pushed = join(repos.root, "pushed-refs");
        const hook = join(repos.root, "hooks", "pre-push");
        await mkdir(join(hook, ".."));
        await writeFile(
          hook,
          `#!/bin/sh\ntee -a ${JSON.stringify(pushed)} | ${JSON.stringify(process.execPath)} ${JSON.stringify(new URL("../scripts/pre-push.ts", import.meta.url).pathname)} "$@"\n`,
        );
        await chmod(hook, 0o755);
        await git(cwd, "config", "core.hooksPath", join(hook, ".."));
        const { github } = fakeGitHub();
        const agent = process.env.CLAUDECODE;
        process.env.CLAUDECODE = "1";
        let result;
        try {
          result = await land({
            ...quiet,
            cwd,
            gate: ["true"],
            github,
            draft: true,
          });
        } finally {
          if (agent === undefined) delete process.env.CLAUDECODE;
          else process.env.CLAUDECODE = agent;
        }

        expect(result).toMatchObject({ ok: true, draft: true });
        const refs = (await readFile(pushed, "utf8"))
          .trim()
          .split("\n")
          .map((line) => line.split(" ")[2]);
        expect(refs).toEqual(["refs/heads/feat/a"]);
        expect(await subjects("main")).toEqual(["seed"]);
      },
      SLOW,
    );

    it(
      "refuses --after-ci before it pushes anything",
      async () => {
        const cwd = await taskClone("a");
        await writeRecord(cwd);
        const { github, pulls } = fakeGitHub();
        const gated = join(repos.root, "gated");

        const result = await land({
          ...quiet,
          cwd,
          gate: ["touch", gated],
          github,
          draft: true,
          afterCi: true,
        });

        expect(result).toMatchObject({ ok: false, step: "preflight" });
        expect(result.ok || result.message).toContain("--after-ci");
        expect(existsSync(gated)).toBe(false);
        expect(pulls).toEqual([]);
        expect(await git(repos.remote, "branch", "--list")).toBe("* main");
      },
      SLOW,
    );
  });

  it(
    "squashes by default and lands the commit checked by CI",
    async () => {
      const cwd = await taskClone("a");
      await repos.commit(cwd, "b.txt", { text: "b", message: "b" });
      const tree = await git(cwd, "rev-parse", "HEAD^{tree}");
      await writeRecord(cwd);
      const { github, checkReads } = fakeGitHub();
      expect(await land({ ...quiet, cwd, github })).toMatchObject({ ok: true });
      const head = await git(repos.remote, "rev-parse", "main");
      expect(checkReads.map((read) => read.commit)).toEqual([head]);
      expect(await subjects("main")).toEqual(["feat: add a", "seed"]);
      expect(
        await git(repos.remote, "show", "-s", "--format=%B", head),
      ).toContain("## Summary");
      expect(await git(repos.remote, "rev-parse", "main^{tree}")).toBe(tree);
    },
    SLOW,
  );

  it(
    "rejects attribution in the squash record before updating the task ref",
    async () => {
      const cwd = await taskClone("a");
      const before = await git(cwd, "rev-parse", "HEAD");
      await writeRecord(cwd, { text: "Made with Cursor" });
      const { github, pulls } = fakeGitHub();
      expect(await land({ ...quiet, cwd, squash: true, github })).toMatchObject(
        { ok: false, step: "rebase" },
      );
      expect(await git(cwd, "rev-parse", "HEAD")).toBe(before);
      expect(pulls).toEqual([]);
    },
    SLOW,
  );

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
        { head: "feat/a", base: "main", title: "feat: add a", merged: true },
      ]);
      expect(pulls[0]!.body).toMatch(/^## Summary\n\nCloses #1\./);
      expect(pulls[0]!.body).not.toContain("# feat: add a");
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
      const gate = [
        `if [ ! -e '${marker}' ]; then`,
        `  touch '${marker}' && cd '${other}' &&`,
        "  echo moved > moved.txt && git add moved.txt &&",
        "  git commit -qm moved && git push -q origin HEAD:refs/heads/main",
        "fi",
      ].join("\n");

      const first = await land({
        ...quiet,
        squash: false,
        cwd,
        gate: ["sh", "-c", gate],
        attempts: 1,
        github,
      });
      expect(first).toMatchObject({ ok: false, step: "push" });
      expect(pulls).toMatchObject([{ merged: false }]);

      await writeRecord(cwd, { title: "feat: add a, again", text: "second" });
      const second = await land({
        ...quiet,
        squash: false,
        cwd,
        gate: ["sh", "-c", gate],
        github,
      });

      expect(second).toMatchObject({ ok: true, record: { merged: true } });
      expect(pulls).toHaveLength(1);
      expect(pulls[0]).toMatchObject({
        title: "feat: add a, again",
        merged: true,
      });
      expect(pulls[0]!.body).toContain("second");
      expect(await subjects("main")).toEqual(["feat: a", "moved", "seed"]);
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
    {
      name: "a squash record whose title is not a Conventional Commits subject",
      write: (cwd: string) => writeRecord(cwd, { title: "Add a" }),
      problem: '"Add a", is the subject of the squash commit',
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

  it(
    "deletes the branch when GitHub shows the PR as merged only on a later read",
    async () => {
      const cwd = await taskClone("a");
      await writeRecord(cwd);
      const { github } = fakeGitHub({ merges: false });
      const reads = ["OPEN", "MERGED"] as const;
      let read = 0;
      github.pullRequestState = async () =>
        reads[Math.min(read++, reads.length - 1)]!;

      const result = await land({ ...quiet, cwd, gate: ["true"], github });

      expect(result).toMatchObject({ ok: true, record: { merged: true } });
      expect(read).toBe(2);
      expect(await git(repos.remote, "branch", "--list", "feat/a")).toBe("");
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
      expect(await subjects("main")).toEqual(["feat: add a", "moved", "seed"]);
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

  function landChild(
    cwd: string,
    extraOptions: {
      conflictCheckMs?: number;
      conflictFetchTimeoutMs?: number;
    } = {},
  ): ChildProcess {
    return child(
      `const { land } = await import(${JSON.stringify(MODULE)});
const result = await land({ cwd: ${JSON.stringify(cwd)}, gate: ["true"], pollMs: 20, say: () => {}, ...${JSON.stringify(extraOptions)} });
console.log(JSON.stringify(result));`,
    );
  }

  async function tickets(): Promise<number> {
    const dir = join(landAdmission().dir(), "queue");
    return (await readdir(dir).catch(() => [])).filter((name) =>
      name.endsWith(".json"),
    ).length;
  }

  async function holdTurn(): Promise<ChildProcess> {
    const holder = child(
      `const slot = await import(${JSON.stringify(SLOT)});
const { landAdmission } = await import(${JSON.stringify(QUEUE)});
const held = await slot.acquireDesktopSlot({ admission: landAdmission(), silenceMs: 600000, pollMs: 20, log: () => {} });
console.log("held");
process.stdin.resume();
process.stdin.on("end", () => { held.release(); process.exit(0); });`,
    );
    await once(holder.stdout!, "data");
    return holder;
  }

  it(
    "lands in the order the lands joined the queue",
    async () => {
      const holder = await holdTurn();
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
      expect(await subjects("main")).toEqual(["feat: b", "feat: a", "seed"]);
      const [a, b] = await waits();
      expect(a).toMatchObject({ source: "feat/a", outcome: "landed" });
      expect(b).toMatchObject({ source: "feat/b", outcome: "landed" });
      expect(b!.waitMs).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "reports a conflict and leaves the queue while the holder still has the turn",
    async () => {
      const holder = await holdTurn();
      const cwd = await taskClone("a");
      const original = await repos.commit(cwd, "README.md", {
        text: "task\n",
        message: "fix: task README",
      });
      const waiter = landChild(cwd, { conflictCheckMs: 50 });
      const result = text(waiter.stdout!);
      await until(async () => (await tickets()) === 1, "the land ticket");
      const upstream = await moveMain("README.md", "upstream\n");

      await until(
        async () => waiter.exitCode !== null,
        "the queued land to exit",
      );
      expect(holder.exitCode).toBeNull();
      expect(JSON.parse(await result)).toMatchObject({
        ok: false,
        step: "rebase",
        exitCode: 1,
        message: expect.stringContaining("README.md"),
      });
      expect(await git(cwd, "rev-parse", "HEAD")).toBe(original);
      expect(await git(cwd, "symbolic-ref", "--short", "HEAD")).toBe("feat/a");
      expect(await git(cwd, "status", "--porcelain")).toBe("");
      expect(await tickets()).toBe(0);
      expect(await waits()).toMatchObject([
        { source: "feat/a", outcome: "failed", step: "rebase" },
      ]);
      expect(await git(repos.remote, "rev-parse", "main")).toBe(upstream);
      holder.stdin!.end();
      await once(holder, "exit");
    },
    SLOW,
  );

  it(
    "stays in the queue when main moves cleanly and lands when the turn is free",
    async () => {
      const holder = await holdTurn();
      const cwd = await taskClone("a");
      const waiter = landChild(cwd, { conflictCheckMs: 50 });
      const result = text(waiter.stdout!);
      await until(async () => (await tickets()) === 1, "the land ticket");
      const upstream = await moveMain("upstream.txt", "upstream\n");

      await until(
        async () =>
          (await git(cwd, "rev-parse", "--verify", "FETCH_HEAD").catch(
            () => "",
          )) === upstream,
        "the queued land to fetch the moved main",
      );
      expect(holder.exitCode).toBeNull();
      expect(waiter.exitCode).toBeNull();
      expect(await tickets()).toBe(1);

      holder.stdin!.end();
      await once(holder, "exit");
      expect(JSON.parse(await result)).toMatchObject({ ok: true });
    },
    SLOW,
  );

  async function landLog(): Promise<string> {
    const dir = join(landStateDir(), "logs");
    const names = await readdir(dir).catch(() => []);
    const texts = await Promise.all(
      names.map((name) => readFile(join(dir, name), "utf8")),
    );
    return texts.join("\n");
  }

  it(
    "keeps waiting when the conflict is with a landed copy of a branch commit, and lands",
    async () => {
      const holder = await holdTurn();
      const cwd = await taskClone("a");
      const first = await repos.commit(cwd, "README.md", {
        text: "first\n",
        message: "fix: first",
      });
      await repos.commit(cwd, "README.md", {
        text: "second\n",
        message: "fix: second",
      });
      await git(cwd, "push", "-q", "origin", `${first}:refs/heads/first`);
      const other = await repos.clone("other");
      await repos.commit(other, "upstream.txt", {
        text: "upstream\n",
        message: "main upstream.txt",
      });
      await git(other, "fetch", "-q", "origin", "first");
      await git(other, "cherry-pick", "FETCH_HEAD");
      await git(other, "push", "-q", "origin", "HEAD:refs/heads/main");
      const waiter = landChild(cwd, { conflictCheckMs: 50 });
      const result = text(waiter.stdout!);

      await until(
        async () => (await landLog()).includes("copies of branch commits"),
        "the queued land to leave the decision to the rebase",
      );
      expect(waiter.exitCode).toBeNull();
      expect(await tickets()).toBe(1);

      holder.stdin!.end();
      await once(holder, "exit");
      expect(JSON.parse(await result)).toMatchObject({ ok: true });
      expect(await subjects("main")).toEqual([
        "fix: second",
        "feat: a",
        "fix: first",
        "main upstream.txt",
        "seed",
      ]);
    },
    SLOW,
  );

  it(
    "skips a conflict check whose fetch hangs, and takes the turn when it is free",
    async () => {
      const holder = await holdTurn();
      const cwd = await taskClone("a");
      await git(
        cwd,
        "config",
        "remote.origin.uploadpack",
        "sleep 120; git-upload-pack",
      );
      const waiter = landChild(cwd, {
        conflictCheckMs: 50,
        conflictFetchTimeoutMs: 200,
      });
      const result = text(waiter.stdout!);

      await until(
        async () => (await landLog()).includes("Conflict check skipped"),
        "the queued land to skip the hung fetch",
      );
      await git(cwd, "config", "--unset", "remote.origin.uploadpack");
      holder.stdin!.end();
      await once(holder, "exit");

      await until(
        async () => waiter.exitCode !== null,
        "the queued land to finish",
      );
      expect(JSON.parse(await result)).toMatchObject({ ok: true });
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
      expect(await subjects("main")).toEqual(["feat: a", "seed"]);
    },
    SLOW,
  );
});
