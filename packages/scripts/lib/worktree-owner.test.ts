import { execFile } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmdirSync, statSync, utimesSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type { GitRepos } from "./__fixtures__/git-repos.ts";
import { git, makeGitRepos } from "./__fixtures__/git-repos.ts";
import { AGENT_ENV } from "./ai-attribution.ts";
import {
  CREATION_WINDOW_MS,
  isNewWorktree,
  isOwner,
  ownerMark,
  refusal,
} from "./worktree-owner.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const JOB = "/jobs/lead";
const SESSION = "11111111-aaaa-4bbb-8ccc-000000000001";

function canSetBirthTime(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "birth-"));
  const past =
    (Temporal.Now.instant().epochMilliseconds - 2 * CREATION_WINDOW_MS) / 1000;
  utimesSync(dir, past, past);
  const moved =
    statSync(dir).birthtimeMs > 0 &&
    statSync(dir).birthtimeMs < past * 1000 + 1000;
  rmdirSync(dir);
  return moved;
}
const CAN_SET_BIRTH_TIME = canSetBirthTime();
function canReadBirthTime(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "birth-"));
  const readable = statSync(dir).birthtimeMs > 0;
  rmdirSync(dir);
  return readable;
}
const BIRTH_TIME_READABLE = canReadBirthTime();
const OWN_REMOVAL = BIRTH_TIME_READABLE ? 0 : 1;
const EMPTY_BIN = mkdtempSync(join(tmpdir(), "no-node-"));
afterAll(() => rmdirSync(EMPTY_BIN));
const toolPath = (name: string) => {
  try {
    return execFileSync("/bin/sh", ["-c", `command -v ${name}`], {
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
};
const CAT = toolPath("cat");
const JQ = toolPath("jq");

const wtToml = await readFile(join(ROOT, ".config/wt.toml"), "utf8");
function hookLine(name: string): string {
  const line = wtToml.split("\n").find((l) => l.startsWith(`${name} = `));
  if (!line) throw new Error(`no ${name} in .config/wt.toml`);
  return JSON.parse(line.slice(name.length + 3)) as string;
}
const settings = JSON.parse(
  await readFile(join(ROOT, ".claude/settings.json"), "utf8"),
) as {
  hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
};

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}
function sh(
  command: string,
  opts: { cwd?: string; env: Record<string, string>; stdin?: string },
): Promise<Run> {
  return new Promise((done) => {
    const child = execFile("/bin/sh", ["-c", command], opts, () => {});
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: string) => (stdout += d));
    child.stderr?.on("data", (d: string) => (stderr += d));
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin?.on("error", () => {});
    child.stdin?.end(opts.stdin ?? "");
  });
}

describe("ownerMark and isOwner", () => {
  it("keeps only the identifiers that are set", () => {
    expect(
      ownerMark({
        CLAUDE_JOB_DIR: JOB,
        CLAUDE_CODE_SESSION_ID: "",
        AI_AGENT: "x",
      }),
    ).toEqual({ CLAUDE_JOB_DIR: JOB });
    expect(
      ownerMark({ CLAUDE_CODE_SESSION_ID: SESSION, CODEX_THREAD_ID: "t1" }),
    ).toEqual({ CLAUDE_CODE_SESSION_ID: SESSION, CODEX_THREAD_ID: "t1" });
    expect(ownerMark({ AI_AGENT: "x" })).toBeUndefined();
  });

  it.each([
    ["the job dir", { CLAUDE_JOB_DIR: JOB, CLAUDE_CODE_SESSION_ID: "new" }],
    ["the session id", { CLAUDE_CODE_SESSION_ID: SESSION }],
  ])("allows the session that the mark names by %s", (_, env) => {
    expect(
      isOwner({ CLAUDE_JOB_DIR: JOB, CLAUDE_CODE_SESSION_ID: SESSION }, env),
    ).toBe(true);
  });

  it("refuses another session, no mark, and empty values", () => {
    const mark = { CLAUDE_JOB_DIR: JOB, CLAUDE_CODE_SESSION_ID: SESSION };
    expect(
      isOwner(mark, {
        CLAUDE_JOB_DIR: "/jobs/other",
        CLAUDE_CODE_SESSION_ID: "x",
      }),
    ).toBe(false);
    expect(isOwner(mark, { CODEX_THREAD_ID: JOB })).toBe(false);
    expect(isOwner(undefined, { CLAUDE_JOB_DIR: JOB })).toBe(false);
    expect(isOwner("text", { CLAUDE_JOB_DIR: JOB })).toBe(false);
    expect(isOwner({ CLAUDE_JOB_DIR: "" }, { CLAUDE_JOB_DIR: "" })).toBe(false);
  });

  describe("Codex threads under one Claude lead", () => {
    const lead = { CLAUDE_JOB_DIR: JOB, CLAUDE_CODE_SESSION_ID: SESSION };
    const thread = (id: string) => ({ ...lead, CODEX_THREAD_ID: id });
    it("refuses a thread the worktree of another thread", () => {
      expect(isOwner(thread("t1"), thread("t2"))).toBe(false);
    });
    it("allows the thread that created the worktree", () => {
      expect(isOwner(thread("t1"), thread("t1"))).toBe(true);
    });
    it("allows the lead the worktree of its thread", () => {
      expect(isOwner(thread("t1"), lead)).toBe(true);
    });
    it("refuses a thread the worktree of its lead", () => {
      expect(isOwner(lead, thread("t1"))).toBe(false);
    });
  });

  it("takes a worktree as new only inside the creation window", () => {
    const now = 1_000_000_000;
    expect(isNewWorktree(now - 1000, now)).toBe(true);
    expect(isNewWorktree(now - CREATION_WINDOW_MS - 1, now)).toBe(false);
    expect(isNewWorktree(0, now)).toBe(false);
  });

  it("gives the agent only the path to report", () => {
    const text = refusal("/w/it's here", "task");
    expect(text).toBe(
      "Could not verify that this session created the worktree at '/w/it'\\''s here' (branch task). Report this path to the person. Do not remove it another way.",
    );
    expect(refusal("/w/d", "")).toBe(
      "Could not verify that this session created the worktree at '/w/d'. Report this path to the person. Do not remove it another way.",
    );
    expect(text).not.toMatch(/ZOTLIT_WT_PERSON|wt remove|rm /);
  });
});

describe("the hook lines of .config/wt.toml", { timeout: 20_000 }, () => {
  let repos: GitRepos;
  let tree: string;
  const nodeDir = dirname(process.execPath);
  const base = (): Record<string, string> => ({
    PATH: `${nodeDir}:/usr/bin:/bin`,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL ?? "",
    GIT_CONFIG_NOSYSTEM: "1",
  });
  const agent = (job: string, session: string) => ({
    ...base(),
    AI_AGENT: "test",
    CLAUDECODE: "1",
    CLAUDE_JOB_DIR: job,
    CLAUDE_CODE_SESSION_ID: session,
  });
  const render = (name: string, primary = ROOT.replace(/\/$/, "")) =>
    hookLine(name)
      .replaceAll("{{ primary_worktree_path }}", primary)
      .replace(/mise trust && mise run init .*$/, "true");
  const guard = (primary?: string) =>
    render("pre-remove", primary).replace(/ && \{ node packages.*$/, "");

  beforeEach(async () => {
    repos = await makeGitRepos();
    const primary = await realpath(await repos.clone("work"));
    tree = join(repos.root, "tree");
    await git(primary, "worktree", "add", "-q", "-b", "task", tree);
  });
  afterEach(async () => {
    await repos.dispose();
  });

  it.each(AGENT_ENV)(
    "treats a caller with only %s set as an agent",
    async (name) => {
      expect((await sh(guard(), { cwd: tree, env: base() })).code).toBe(0);
      expect(
        (await sh(guard(), { cwd: tree, env: { ...base(), [name]: "1" } }))
          .code,
      ).toBe(1);
    },
  );

  it("lets a Codex-only session remove the worktree that it created", async () => {
    const codex = (id: string) => ({ ...base(), CODEX_THREAD_ID: id });
    expect(
      (await sh(render("pre-start"), { cwd: tree, env: codex("t1") })).code,
    ).toBe(0);
    expect((await sh(guard(), { cwd: tree, env: codex("t2") })).code).toBe(1);
    expect((await sh(guard(), { cwd: tree, env: codex("t1") })).code).toBe(
      OWN_REMOVAL,
    );
  });

  it("gives the path only for a detached worktree", async () => {
    const detached = join(repos.root, "detached");
    await git(tree, "worktree", "add", "-q", "--detach", detached);
    const run = await sh(guard(), { cwd: detached, env: agent(JOB, SESSION) });
    expect(run.code).toBe(1);
    expect(run.stderr.trim()).toBe(refusal(await realpath(detached), ""));
  });

  it(`lets a session remove the worktree that it created, after a resume too (refused where the file system gives no birth time: ${BIRTH_TIME_READABLE ? "it gives one here" : "none here"})`, async () => {
    expect(
      (await sh(render("pre-start"), { cwd: tree, env: agent(JOB, SESSION) }))
        .code,
    ).toBe(0);
    expect(
      (await sh(guard(), { cwd: tree, env: agent(JOB, SESSION) })).code,
    ).toBe(OWN_REMOVAL);
    expect(
      (await sh(guard(), { cwd: tree, env: agent(JOB, "resumed") })).code,
    ).toBe(OWN_REMOVAL);
  });

  it("refuses another session and keeps the first mark", async () => {
    await sh(render("pre-start"), { cwd: tree, env: agent(JOB, SESSION) });
    await sh(render("pre-start"), {
      cwd: tree,
      env: agent("/jobs/other", "other"),
    });
    const run = await sh(guard(), {
      cwd: tree,
      env: agent("/jobs/other", "other"),
    });
    expect(run.code).toBe(1);
    expect(run.stderr.trim()).toBe(refusal(await realpath(tree), "task"));
    expect((await sh(guard(), { cwd: tree, env: agent(JOB, "x") })).code).toBe(
      OWN_REMOVAL,
    );
  });

  it("refuses an agent when the worktree has no mark", async () => {
    await sh(render("pre-start"), { cwd: tree, env: base() });
    expect(
      (await sh(guard(), { cwd: tree, env: agent(JOB, SESSION) })).code,
    ).toBe(1);
  });

  it.skipIf(!CAN_SET_BIRTH_TIME)(
    "does not mark an older worktree when an agent replays pre-start (skipped where utimes cannot set a folder's birth time, such as Linux ext4)",
    async () => {
      const admin = await git(tree, "rev-parse", "--absolute-git-dir");
      const past =
        (Temporal.Now.instant().epochMilliseconds - 2 * CREATION_WINDOW_MS) /
        1000;
      await utimes(admin, past, past);
      const run = await sh(render("pre-start"), {
        cwd: tree,
        env: agent(JOB, SESSION),
      });
      expect(run.code).toBe(0);
      expect(run.stderr.trim().split("\n")).toHaveLength(1);
      expect(run.stderr).toContain("warning:");
      expect(
        (await sh(guard(), { cwd: tree, env: agent(JOB, SESSION) })).code,
      ).toBe(1);
    },
  );

  it("passes a person and the person's prefix without Node", async () => {
    const noNode = { PATH: EMPTY_BIN };
    expect((await sh(guard(), { cwd: tree, env: noNode })).code).toBe(0);
    const prefixed = {
      ...agent(JOB, SESSION),
      ...noNode,
      ZOTLIT_WT_PERSON: "1",
    };
    expect((await sh(guard(), { cwd: tree, env: prefixed })).code).toBe(0);
    expect(
      (
        await sh(guard(), {
          cwd: tree,
          env: { ...agent(JOB, SESSION), ...noNode },
        })
      ).code,
    ).not.toBe(0);
  });

  it("creates the worktree with a warning when Node is missing", async () => {
    const env = { ...agent(JOB, SESSION), PATH: EMPTY_BIN };
    const run = await sh(render("pre-start"), { cwd: tree, env });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain(
      "warning: could not write the owner mark of this worktree",
    );
  });

  it("names the cause in one line when the primary checkout lacks the guard", async () => {
    const primary = join(repos.root, "old-primary");
    const cause = `the worktree guard is not in the primary checkout at ${primary}; update that checkout to main`;
    const start = await sh(render("pre-start", primary), {
      cwd: tree,
      env: agent(JOB, SESSION),
    });
    expect(start.code).toBe(0);
    expect(start.stderr.trim().split("\n")).toEqual([
      expect.stringContaining(cause),
    ]);
    const remove = await sh(guard(primary), {
      cwd: tree,
      env: agent(JOB, SESSION),
    });
    expect(remove.code).toBe(1);
    expect(remove.stderr.trim()).toBe(cause);
  });
});

describe("the Bash tool hook of .claude/settings.json", () => {
  const handler = settings.hooks.PreToolUse.find((h) => h.matcher === "Bash");
  const dirs: Record<string, string> = {};
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "tool-hook-"));
    for (const [name, tools] of [
      ["with jq", [CAT, JQ]],
      ["without jq", [CAT]],
    ] as const) {
      const dir = join(root, name.replace(" ", "-"));
      await mkdir(dir);
      for (const tool of tools)
        if (tool) await symlink(tool, join(dir, tool.split("/").pop() ?? ""));
      dirs[name] = dir;
    }
    dirs.root = root;
  });
  afterAll(async () => {
    await rm(dirs.root ?? "", { recursive: true, force: true });
  });
  const run = (
    command: string,
    description: string,
    opts: { mode: string; raw?: string },
  ) =>
    sh(handler?.hooks[0]?.command ?? "exit 9", {
      env: { PATH: dirs[opts.mode] ?? "" },
      stdin:
        opts.raw ??
        JSON.stringify({
          cwd: "/repo",
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command, description },
        }),
    });

  describe.each(["with jq", "without jq"])("%s", (mode) => {
    it
      .skipIf(mode === "with jq" && !JQ)
      .each([
        [
          "ZOTLIT_WT_PERSON=1 wt remove x",
          "ZOTLIT_WT_PERSON is for the person only. Report the worktree path to the person.",
        ],
        ["wt remove x --no-hooks", "Run the command without --no-hooks."],
        [
          "git -C /repo worktree remove --force ../x",
          "remove a worktree with: wt remove <branch>",
        ],
        ...AGENT_ENV.flatMap((name) =>
          [
            `${name}= wt remove --foreground x`,
            `env -u ${name} wt remove x`,
            `unset ${name}; wt remove x`,
          ].map((command) => [
            command,
            "an agent session keeps its agent variables for wt",
          ]),
        ),
      ])("refuses %s", async (command, text) => {
      const result = await run(command, "test", { mode });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(text);
      expect(result.stderr).not.toContain("file");
    });

    it
      .skipIf(mode === "with jq" && !JQ)
      .each([
        "git status",
        "wt remove x",
        "rg worktree",
        "pnpm land --no-verify --no-ci",
      ])("passes %s", async (command) => {
      expect(await run(command, "Land the wt guide", { mode })).toEqual({
        code: 0,
        stdout: "",
        stderr: "",
      });
    });

    it("passes a variable change in a command that does not run wt", async () => {
      expect(
        (await run("AI_AGENT= node probe.ts", "Run a probe", { mode })).code,
      ).toBe(0);
    });

    it.each([
      "echo 'run git worktree remove'",
      "echo 'about ZOTLIT_WT_PERSON'",
      "echo 'AI_AGENT= is how wt sees a person'",
    ])("refuses the mention %s with the way forward", async (command) => {
      const result = await run(command, "test", { mode });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(
        "If the command only mentions these words, reword it.",
      );
    });
  });

  it.skipIf(!JQ)("reads only the command when jq is on PATH", async () => {
    const search = "rg -- '--no-hooks' docs";
    expect(
      (await run(search, "Search the docs", { mode: "without jq" })).code,
    ).toBe(0);
    expect(
      (await run(search, "Search the wt docs", { mode: "with jq" })).code,
    ).toBe(0);
    const fallback = await run(search, "Search the wt docs", {
      mode: "without jq",
    });
    expect(fallback.code).toBe(2);
    expect(fallback.stderr).toContain(
      "If the command does not run wt, leave the word wt out of its description.",
    );
    const read = await run("rg -- 'wt remove --no-hooks' docs", "Search", {
      mode: "with jq",
    });
    expect(read.code).toBe(2);
    expect(read.stderr).toContain(
      "If the command only mentions --no-hooks, reword the command.",
    );
    expect(read.stderr).not.toContain("description");
  });

  it.skipIf(!JQ)(
    "checks the raw input when jq cannot parse the event",
    async () => {
      const truncated =
        '{"tool_name":"Bash","tool_input":{"command":"git worktree remove ../x"';
      expect(
        (await run("", "", { mode: "with jq", raw: truncated })).code,
      ).toBe(2);
    },
  );
});
