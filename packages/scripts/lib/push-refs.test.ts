import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { git, makeGitRepos } from "./__fixtures__/git-repos.ts";
import type { GitRepos } from "./__fixtures__/git-repos.ts";
import { acquireDesktopSlot } from "./desktop-slot.ts";
import { landAdmission, LAND_TURN_ENV } from "./land-queue.ts";

// Each case pushes from a real clone whose pre-push hook runs pre-push.ts, as
// Lefthook runs it, to a bare origin in a temporary folder.
const SLOW = 20_000;
const HOOK = new URL("../scripts/pre-push.ts", import.meta.url).pathname;
const AGENT_ENV = [
  "AI_AGENT",
  "CLAUDE_CODE",
  "CLAUDECODE",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
];

let repos: GitRepos;
let cwd: string;
beforeEach(async () => {
  repos = await makeGitRepos();
  cwd = await repos.clone("work");
  const hooks = join(repos.root, "hooks");
  await mkdir(hooks);
  const hook = join(hooks, "pre-push");
  await writeFile(
    hook,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(HOOK)} "$@"\n`,
  );
  await chmod(hook, 0o755);
  await git(cwd, "config", "core.hooksPath", hooks);
  await git(cwd, "switch", "-q", "-c", "feat/a");
  await repos.commit(cwd, "a.txt", { text: "a\n" });
});
afterEach(async () => {
  await repos.dispose();
});

/** Push `refspec` from the clone with the extra environment `env`. */
async function push(
  refspec: string,
  env: Record<string, string> = {},
): Promise<{ ok: boolean; stderr: string }> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !AGENT_ENV.includes(key) && key !== LAND_TURN_ENV,
    ),
  );
  try {
    const { stderr } = await promisify(execFile)(
      "git",
      ["push", "-q", "origin", refspec],
      { cwd, env: { ...base, ...env } },
    );
    return { ok: true, stderr };
  } catch (error) {
    return { ok: false, stderr: (error as { stderr: string }).stderr };
  }
}

const onOrigin = async (branch: string) =>
  (await git(repos.remote, "branch", "--list", branch)) !== "";

describe("the pre-push hook", () => {
  it(
    "lets a person push a task branch without a gate",
    async () => {
      expect(await push("HEAD:refs/heads/feat/a")).toMatchObject({ ok: true });
      expect(await onOrigin("feat/a")).toBe(true);
    },
    SLOW,
  );

  it.each(["next", "main"])(
    "refuses a person's push to %s",
    async (branch) => {
      const result = await push(`HEAD:refs/heads/${branch}`);

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("pnpm land");
      expect(await git(repos.remote, "log", "--format=%s", "next")).toBe(
        "seed",
      );
    },
    SLOW,
  );

  it(
    "refuses every push from an agent session",
    async () => {
      const result = await push("HEAD:refs/heads/feat/a", { CLAUDECODE: "1" });

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("An agent session pushes nothing itself");
      expect(await onOrigin("feat/a")).toBe(false);
    },
    SLOW,
  );

  it(
    "refuses a commit that credits an agent",
    async () => {
      await repos.commit(cwd, "b.txt", {
        text: "b\n",
        message: "add b\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
      });

      const result = await push("HEAD:refs/heads/feat/a");

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("credits an AI agent");
    },
    SLOW,
  );

  it(
    "lets a land push next from an agent session while it holds the Land Turn",
    async () => {
      const turn = await acquireDesktopSlot({
        admission: landAdmission("next"),
        silenceMs: 600_000,
        pollMs: 10,
        signals: false,
        log: () => {},
      });
      const token = turn.owner.token;
      try {
        const result = await push("HEAD:refs/heads/next", {
          CLAUDECODE: "1",
          [LAND_TURN_ENV]: token,
        });
        expect(result).toMatchObject({ ok: true });
      } finally {
        turn.release();
      }
      // The same token, once the turn is over, is refused.
      await repos.commit(cwd, "b.txt", { text: "b\n" });
      const late = await push("HEAD:refs/heads/next", {
        [LAND_TURN_ENV]: token,
      });
      expect(late.ok).toBe(false);
      expect(await git(repos.remote, "log", "--format=%s", "-1", "next")).toBe(
        "change a.txt",
      );
    },
    SLOW,
  );
});
