import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmdirSync, statSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url).pathname;
const REFUSAL = "Could not verify that this session created the worktree";

function findWt(): string | undefined {
  for (const probe of ["mise which wt", "command -v wt"]) {
    try {
      const path = execFileSync("/bin/sh", ["-c", probe], {
        encoding: "utf8",
      }).trim();
      execFileSync(path, ["--version"], {
        env: { PATH: "/usr/bin:/bin", HOME: tmpdir() },
      });
      return path;
    } catch {
      continue;
    }
  }
  return undefined;
}
const WT = findWt();
function canReadBirthTime(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "birth-"));
  const readable = statSync(dir).birthtimeMs > 0;
  rmdirSync(dir);
  return readable;
}
const BIRTH = canReadBirthTime();
const ownCase = BIRTH ? it : it.skip;

interface Run {
  code: number | null;
  out: string;
}

describe.skipIf(!WT)(
  "the hooks of .config/wt.toml with the real wt binary (skipped when wt is not on PATH)",
  () => {
    let root: string;
    let primary: string;
    let base: Record<string, string>;
    const agent = (job: string, session: string) => ({
      ...base,
      AI_AGENT: "test",
      CLAUDECODE: "1",
      CLAUDE_JOB_DIR: job,
      CLAUDE_CODE_SESSION_ID: session,
    });
    const lead = () => agent("/jobs/lead", "lead-session");
    const other = () => agent("/jobs/other", "other-session");

    function sh(
      script: string,
      env: Record<string, string>,
      cwd = primary,
    ): Promise<Run> {
      return new Promise((done) => {
        const child = execFile(
          "/bin/sh",
          ["-c", script],
          { cwd, env },
          () => {},
        );
        let out = "";
        child.stdout?.on("data", (d: string) => (out += d));
        child.stderr?.on("data", (d: string) => (out += d));
        child.on("close", (code) => done({ code, out }));
      });
    }
    const tree = (branch: string) =>
      join(root, `repo.${branch.replaceAll("/", "-")}`);
    const exists = (path: string) =>
      readFile(join(path, ".scratch/work.txt"), "utf8").then(
        () => true,
        () => false,
      );
    async function create(branch: string, env: Record<string, string>) {
      const run = await sh(`wt switch --create ${branch} --no-cd`, env);
      expect(run.code, run.out).toBe(0);
      await mkdir(join(tree(branch), ".scratch"));
      await writeFile(join(tree(branch), ".scratch/work.txt"), "work\n");
    }

    beforeAll(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), "wt-owner-")));
      primary = join(root, "repo");
      const home = join(root, "home");
      const bin = join(root, "bin");
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, "mise"), "#!/bin/sh\nexit 0\n");
      await chmod(join(bin, "mise"), 0o755);
      await writeFile(
        join(root, "gitconfig"),
        "[user]\n  name = Test\n  email = test@example.com\n[init]\n  defaultBranch = main\n",
      );
      base = {
        PATH: [
          bin,
          dirname(WT ?? ""),
          dirname(process.execPath),
          "/usr/bin",
          "/bin",
        ].join(":"),
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1",
      };
      await mkdir(primary, { recursive: true });
      for (const path of [
        ".config/wt.toml",
        "packages/scripts/package.json",
        "packages/scripts/lib/worktree-owner.ts",
        "packages/scripts/scripts/worktree-owner.ts",
      ]) {
        await mkdir(dirname(join(primary, path)), { recursive: true });
        await cp(join(ROOT, path), join(primary, path));
      }
      await writeFile(join(primary, ".gitignore"), ".scratch/\n");
      const setup = await sh(
        "git init -q && git add -A && git commit -q -m init && wt config approvals add --yes",
        base,
      );
      expect(setup.code, setup.out).toBe(0);
    }, 30_000);
    afterAll(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const refused = (out: string, branch: string) =>
      out.includes(`${REFUSAL} at '${tree(branch)}' (branch ${branch})`);

    ownCase(
      "lets an agent remove each worktree that it created in a loop and in the background",
      async () => {
        const made = await sh(
          "for b in loop/a loop/b; do wt switch --create $b --no-cd || exit 1; done; wt switch --create loop/c --no-cd & wait $!",
          lead(),
        );
        expect(made.code, made.out).toBe(0);
        for (const b of ["loop/a", "loop/b", "loop/c"]) {
          const run = await sh(
            `wt remove --foreground ${b}`,
            agent("/jobs/lead", "resumed-session"),
          );
          expect(run.code, run.out).toBe(0);
        }
        expect((await sh("git worktree list", base)).out).not.toContain(
          "repo.loop-",
        );
      },
      60_000,
    );

    ownCase(
      "keeps the worktrees of a person and of another session in the incident loop",
      async () => {
        await create("incident/own", lead());
        await create("incident/person", base);
        await create("incident/other", other());
        const loop = await sh(
          "for b in $(git worktree list --porcelain | sed -n 's|^branch refs/heads/||p' | grep '^incident/'); do wt remove --foreground -D \"$b\"; done",
          lead(),
        );
        expect(refused(loop.out, "incident/person"), loop.out).toBe(true);
        expect(refused(loop.out, "incident/other"), loop.out).toBe(true);
        expect(await exists(tree("incident/own"))).toBe(false);
        expect(await exists(tree("incident/person"))).toBe(true);
        expect(await exists(tree("incident/other"))).toBe(true);
      },
      60_000,
    );

    it.runIf(!BIRTH)(
      "refuses the creator's removal where the file system gives no birth time (the own-worktree tests are skipped there)",
      async () => {
        await create("nobirth/own", lead());
        const run = await sh("wt remove --foreground nobirth/own", lead());
        expect(refused(run.out, "nobirth/own"), run.out).toBe(true);
        expect(await exists(tree("nobirth/own"))).toBe(true);
      },
      30_000,
    );

    it("lets a person remove any worktree with no guard text", async () => {
      await create("person/foreign", other());
      const run = await sh("wt remove --foreground person/foreign", base);
      expect(run.code, run.out).toBe(0);
      expect(run.out).not.toContain(REFUSAL);
      expect(await exists(tree("person/foreign"))).toBe(false);
    }, 30_000);

    it("lets the person's prefix remove a worktree in an agent environment", async () => {
      await create("prefix/person", base);
      const run = await sh(
        "ZOTLIT_WT_PERSON=1 wt remove --foreground prefix/person",
        lead(),
      );
      expect(run.code, run.out).toBe(0);
      expect(await exists(tree("prefix/person"))).toBe(false);
    }, 30_000);

    ownCase(
      "stops a multi-branch remove at the first foreign worktree",
      async () => {
        await create("multi/a", lead());
        await create("multi/b", other());
        await create("multi/c", lead());
        const run = await sh(
          "wt remove --foreground multi/a multi/b multi/c",
          lead(),
        );
        expect(run.code).toBe(1);
        expect(refused(run.out, "multi/b"), run.out).toBe(true);
        expect(await exists(tree("multi/a"))).toBe(false);
        expect(await exists(tree("multi/b"))).toBe(true);
        expect(await exists(tree("multi/c"))).toBe(true);
      },
      60_000,
    );

    ownCase(
      "checks a removal that runs inside an own worktree",
      async () => {
        await create("inside/own", lead());
        await create("inside/self", lead());
        await create("inside/other", other());
        const foreign = await sh(
          "wt remove --foreground inside/other",
          lead(),
          tree("inside/own"),
        );
        expect(refused(foreign.out, "inside/other"), foreign.out).toBe(true);
        expect(await exists(tree("inside/other"))).toBe(true);
        const self = await sh(
          "wt remove --foreground",
          lead(),
          tree("inside/self"),
        );
        expect(self.code, self.out).toBe(0);
        expect(await exists(tree("inside/self"))).toBe(false);
      },
      60_000,
    );

    ownCase(
      "checks a removal with -C",
      async () => {
        await create("dash-c/own", lead());
        await create("dash-c/other", other());
        const foreign = await sh(
          `wt -C ${tree("dash-c/own")} remove --foreground dash-c/other`,
          lead(),
        );
        expect(refused(foreign.out, "dash-c/other"), foreign.out).toBe(true);
        expect(await exists(tree("dash-c/other"))).toBe(true);
        const own = await sh(
          `wt -C ${tree("dash-c/other")} remove --foreground dash-c/own`,
          lead(),
        );
        expect(own.code, own.out).toBe(0);
        expect(await exists(tree("dash-c/own"))).toBe(false);
      },
      60_000,
    );

    ownCase(
      "removes the own worktrees in wt step prune and keeps the foreign ones",
      async () => {
        await create("prune/other", other());
        await create("prune/person", base);
        await create("prune/own", lead());
        const run = await sh("wt step prune --min-age=0s --foreground", lead());
        expect(run.code).toBe(1);
        expect(await exists(tree("prune/own"))).toBe(false);
        expect(await exists(tree("prune/other")), run.out).toBe(true);
        expect(await exists(tree("prune/person"))).toBe(true);
      },
      60_000,
    );
  },
);
