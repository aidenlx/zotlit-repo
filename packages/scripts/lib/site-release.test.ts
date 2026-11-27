import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GitRepos } from "./__fixtures__/git-repos.ts";
import { git, makeGitRepos } from "./__fixtures__/git-repos.ts";
import type { Git } from "./site-release.ts";
import {
  deployVerdict,
  gitIn,
  liveVersion,
  nextSiteTag,
  parseVersionDocument,
  pickedFrom,
  pickOnto,
  planPicks,
  revertTo,
  syncTo,
  tagMessage,
} from "./site-release.ts";

const SLOW = 20_000;

describe("site tags", () => {
  it("numbers the next release after the greatest site tag", () => {
    expect(nextSiteTag(["site-2", "site-10", "site-x", "2.3.0"])).toBe(
      "site-11",
    );
    expect(nextSiteTag([])).toBe("site-1");
  });

  it("reads the live tag from the version document", () => {
    expect(parseVersionDocument({ tag: "site-4" })).toBe("site-4");
    expect(parseVersionDocument({ tag: null })).toBeUndefined();
    expect(parseVersionDocument("oops")).toBeUndefined();
  });
});

describe("pickedFrom", () => {
  it("takes the last cherry-pick line, which the site release wrote", () => {
    const first = "a".repeat(40);
    const last = "b".repeat(40);
    expect(
      pickedFrom(
        `fix\n\n(cherry picked from commit ${first})\n\n(cherry picked from commit ${last})`,
      ),
    ).toBe(last);
    expect(pickedFrom("fix")).toBeUndefined();
  });
});

describe("release commits", () => {
  let repos: GitRepos;
  let cwd: string;
  let g: Git;
  let seed: string;
  const files = async (commit: string) =>
    (await git(cwd, "ls-tree", "--name-only", commit)).split("\n");
  const show = async (commit: string, file: string) =>
    await git(cwd, "show", `${commit}:${file}`);

  beforeEach(async () => {
    repos = await makeGitRepos();
    cwd = await repos.clone("work");
    g = gitIn(cwd);
    seed = await git(cwd, "rev-parse", "HEAD");
  });
  afterEach(async () => {
    await repos.dispose();
  });

  it(
    "picks a later fix onto the live site and leaves the earlier unfinished change out",
    async () => {
      await repos.commit(cwd, "feature.txt", { text: "unfinished\n" });
      const fix = await repos.commit(cwd, "fix.txt", { text: "fix\n" });

      const result = await pickOnto(g, seed, [fix]);

      expect(await files(result.commit)).toEqual(["README.md", "fix.txt"]);
      expect(
        await git(cwd, "log", "-1", "--format=%B", result.commit),
      ).toContain(`(cherry picked from commit ${fix})`);
      expect(await git(cwd, "rev-parse", `${result.commit}^`)).toBe(seed);

      const again = await pickOnto(g, result.commit, [fix]);
      expect(again.commit).toBe(result.commit);
      expect(again.contained.map((pick) => pick.sha)).toEqual([fix]);
    },
    SLOW,
  );

  it(
    "orders picks as main does, notes live ones, and refuses a commit main lacks",
    async () => {
      const a = await repos.commit(cwd, "a.txt", { text: "a\n" });
      const b = await repos.commit(cwd, "b.txt", { text: "b\n" });
      const c = await repos.commit(cwd, "c.txt", { text: "c\n" });

      expect(await planPicks(g, { live: a, main: c, shas: [c, a, b] })).toEqual(
        { pending: [b, c], live: [a] },
      );

      await git(cwd, "switch", "-q", "-c", "side", seed);
      const side = await repos.commit(cwd, "d.txt", { text: "d\n" });
      await expect(
        planPicks(g, { live: seed, main: c, shas: [side] }),
      ).rejects.toThrow(/is not on main/);
    },
    SLOW,
  );

  it(
    "refuses a fix that depends on a change the live site lacks",
    async () => {
      await repos.commit(cwd, "page.txt", { text: "draft\n" });
      const fix = await repos.commit(cwd, "page.txt", {
        text: "draft fixed\n",
      });

      await expect(pickOnto(g, seed, [fix])).rejects.toThrow(
        /conflicts with the live site in: page\.txt/,
      );
    },
    SLOW,
  );

  it(
    "syncs to main on top of the live picks once main holds them",
    async () => {
      await repos.commit(cwd, "feature.txt", { text: "unfinished\n" });
      const fix = await repos.commit(cwd, "fix.txt", { text: "fix\n" });
      const live = (await pickOnto(g, seed, [fix])).commit;
      const later = await repos.commit(cwd, "feature.txt", { text: "done\n" });

      const result = await syncTo(g, {
        live: live,
        target: later,
        main: later,
      });

      expect(result.lost).toEqual([]);
      expect(
        (await git(cwd, "log", "-1", "--format=%P", result.commit)).split(" "),
      ).toEqual([live, later]);
      expect(await show(result.commit, "feature.txt")).toBe("done");
    },
    SLOW,
  );

  it(
    "refuses a sync to a commit that lacks a live pick or a live main commit",
    async () => {
      const draft = await repos.commit(cwd, "feature.txt", { text: "a\n" });
      const fix = await repos.commit(cwd, "fix.txt", { text: "fix\n" });
      const live = (await pickOnto(g, seed, [fix])).commit;

      const result = await syncTo(g, { live, target: draft, main: fix });
      expect(result.lost.map((pick) => pick.sha)).toEqual([fix]);

      const synced = await syncTo(g, { live, target: fix, main: fix });
      const back = await syncTo(g, {
        live: synced.commit,
        target: draft,
        main: fix,
      });
      expect(back.lost.map((pick) => pick.sha)).toContain(fix);
    },
    SLOW,
  );

  it(
    "fast-forwards when the live site is a commit of main",
    async () => {
      const next = await repos.commit(cwd, "page.txt", { text: "new\n" });
      expect(
        (await syncTo(g, { live: seed, target: next, main: next })).commit,
      ).toBe(next);
    },
    SLOW,
  );

  it(
    "reverts to an earlier release on top of the live one",
    async () => {
      await git(cwd, "tag", "-a", "site-1", seed, "-m", "site-1");
      const next = await repos.commit(cwd, "page.txt", { text: "bad\n" });

      const commit = await revertTo(g, next, "refs/tags/site-1");

      expect(await git(cwd, "rev-parse", `${commit}^`)).toBe(next);
      expect(await files(commit)).toEqual(["README.md"]);
      expect(await git(cwd, "log", "-1", "--format=%B", commit)).toContain(
        "Site-Revert: refs/tags/site-1",
      );
    },
    SLOW,
  );

  describe("deploy verdict", () => {
    const tag = async (name: string, commit: string, mode = "pick") =>
      await git(
        cwd,
        "tag",
        "-a",
        name,
        commit,
        "-m",
        tagMessage({
          tag: name,
          mode: mode as "pick",
          live: undefined,
          main: commit,
          picks: [],
        }),
      );

    it(
      "deploys a release that descends from the live one and refuses an old job",
      async () => {
        await tag("site-1", seed, "bootstrap");
        const next = await repos.commit(cwd, "page.txt", { text: "new\n" });
        await tag("site-2", next);

        expect(
          await deployVerdict(g, { tag: "site-2", live: "site-1" }),
        ).toMatchObject({ ok: true });
        expect(
          await deployVerdict(g, { tag: "site-1", live: "site-2" }),
        ).toMatchObject({
          ok: false,
          reason: expect.stringContaining(
            "does not descend from the live site-2",
          ),
        });
        expect(
          await deployVerdict(g, { tag: "site-2", live: "site-2" }),
        ).toMatchObject({ ok: false });
      },
      SLOW,
    );

    it(
      "deploys without a live release only a bootstrap release",
      async () => {
        await tag("site-1", seed, "bootstrap");
        await tag("site-2", seed);

        expect(
          await deployVerdict(g, { tag: "site-1", live: undefined }),
        ).toMatchObject({ ok: true });
        expect(
          await deployVerdict(g, { tag: "site-2", live: undefined }),
        ).toMatchObject({ ok: false });
        expect(
          await deployVerdict(g, { tag: "site-2", live: "2.3.0" }),
        ).toMatchObject({ ok: false });
      },
      SLOW,
    );
  });
});

describe("liveVersion", () => {
  const api = (deployments: unknown, annotations: unknown = {}) => ({
    accountId: "acc",
    token: "t",
    worker: "zotlit-docs",
    fetch: (async (url: string) =>
      Response.json(
        url.endsWith("/deployments")
          ? { result: { deployments } }
          : { result: { annotations } },
      )) as typeof fetch,
  });

  it("reads the tag of the version that serves all traffic", async () => {
    expect(
      await liveVersion(
        api([{ versions: [{ version_id: "v1", percentage: 100 }] }], {
          "workers/tag": "site-3",
        }),
      ),
    ).toEqual({ versionId: "v1", tag: "site-3" });
  });

  it("refuses a deployment that splits traffic", async () => {
    await expect(
      liveVersion(
        api([
          {
            versions: [
              { version_id: "v1", percentage: 50 },
              { version_id: "v2", percentage: 50 },
            ],
          },
        ]),
      ),
    ).rejects.toThrow(/splits traffic/);
  });
});
