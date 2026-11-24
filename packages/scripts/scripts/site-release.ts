#!/usr/bin/env node
import type { Pick, SiteMode } from "#site-release";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { SOURCE_BRANCH, SOURCE_REPOSITORY } from "@zotlit/config/repositories";

import { getWorkspaceRoot } from "#package-roots";
import {
  commitOf,
  gitIn,
  isAncestor,
  nextSiteTag,
  parseVersionDocument,
  pickOnto,
  planPicks,
  PRODUCTION_ORIGIN,
  revertTo,
  siteTagNumber,
  syncTo,
  tagMessage,
  VERSION_PATH,
} from "#site-release";

const root = await getWorkspaceRoot(import.meta.dirname);
const git = gitIn(root);
const MAIN = `origin/${SOURCE_BRANCH}`;

async function run(args: readonly string[]): Promise<string> {
  const result = await git(args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

async function liveTag(): Promise<string | undefined> {
  const response = await fetch(`${PRODUCTION_ORIGIN}${VERSION_PATH}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `${PRODUCTION_ORIGIN}${VERSION_PATH} answered ${response.status}.`,
    );
  }
  return parseVersionDocument(await response.json());
}

async function prCommits(pr: number): Promise<string[]> {
  const { stdout } = await promisify(execFile)(
    "gh",
    [
      "pr",
      "view",
      String(pr),
      "--repo",
      SOURCE_REPOSITORY,
      "--json",
      "commits",
      "--jq",
      ".commits[].oid",
    ],
    { cwd: root },
  );
  return stdout.split("\n").filter(Boolean);
}

interface Request {
  pick?: number[];
  to?: string;
  revertTo?: string;
  bootstrap: boolean;
  dryRun: boolean;
}

interface Plan {
  mode: SiteMode;
  commit: string;
  picks: Pick[];
  notes: string[];
}

async function plan(
  request: Request,
  live: string | undefined,
  main: string,
): Promise<Plan> {
  if (request.bootstrap) {
    if (live !== undefined) {
      throw new Error(
        `The live site is ${live}: --bootstrap starts the site releases once, before any is live.`,
      );
    }
    const commit = await commitOf(git, request.to ?? MAIN);
    if (!(await isAncestor(git, commit, main))) {
      throw new Error(`${request.to ?? MAIN} is not a commit of ${MAIN}.`);
    }
    return { mode: "bootstrap", commit, picks: [], notes: [] };
  }
  if (live === undefined) {
    throw new Error(
      `${PRODUCTION_ORIGIN}${VERSION_PATH} names no site release. Release once with --bootstrap --to <commit>.`,
    );
  }
  const liveCommit = await commitOf(git, `refs/tags/${live}`);
  if (request.pick !== undefined) {
    const shas: string[] = [];
    for (const pr of request.pick) shas.push(...(await prCommits(pr)));
    const { pending, live: alreadyLive } = await planPicks(git, {
      live: liveCommit,
      main,
      shas,
    });
    const result = await pickOnto(git, liveCommit, pending);
    const notes = [
      ...alreadyLive.map((sha) => `${sha.slice(0, 12)} is live already.`),
      ...result.contained.map(
        (pick) =>
          `${pick.sha.slice(0, 12)} (${pick.subject}) changes nothing on the live site.`,
      ),
    ];
    return { mode: "pick", commit: result.commit, picks: result.picked, notes };
  }
  if (request.revertTo !== undefined) {
    if (siteTagNumber(request.revertTo) === undefined) {
      throw new Error(`--revert-to takes a site tag, such as site-3.`);
    }
    return {
      mode: "revert",
      commit: await revertTo(git, liveCommit, `refs/tags/${request.revertTo}`),
      picks: [],
      notes: [],
    };
  }
  const target = await commitOf(git, request.to ?? MAIN);
  if (!(await isAncestor(git, target, main))) {
    throw new Error(`${request.to ?? MAIN} is not a commit of ${MAIN}.`);
  }
  const result = await syncTo(git, {
    live: liveCommit,
    target: target,
    main: main,
  });
  if (result.lost.length > 0) {
    throw new Error(
      [
        `${target.slice(0, 12)} lacks changes that are live:`,
        ...result.lost.map(
          (pick) => `  ${pick.sha.slice(0, 12)} ${pick.subject}`,
        ),
        "Release with --to a later commit of main that holds them.",
      ].join("\n"),
    );
  }
  return {
    mode: "sync",
    commit: result.commit,
    picks: [],
    notes: result.reverts.map(
      (pick) => `${pick.subject}: the sync replaces this revert with main.`,
    ),
  };
}

async function release(request: Request): Promise<void> {
  await run(["fetch", "--quiet", "--tags", "--force", "origin", SOURCE_BRANCH]);
  const live = await liveTag();
  const main = await commitOf(git, MAIN);
  const result = await plan(request, live, main);
  if (
    live !== undefined &&
    result.commit === (await commitOf(git, `refs/tags/${live}`))
  ) {
    for (const note of result.notes) console.log(note);
    console.log(`Nothing to release: the change is the live ${live}.`);
    return;
  }
  const remoteTags = (
    await run(["ls-remote", "--tags", "--refs", "origin", "site-*"])
  )
    .split("\n")
    .map((line) => line.split("refs/tags/")[1] ?? "");
  const tag = nextSiteTag(remoteTags);
  const message = tagMessage({
    tag,
    mode: result.mode,
    live,
    main,
    picks: result.picks,
  });
  console.log(message);
  for (const note of result.notes) console.log(`Note: ${note}`);
  const base = live ?? main;
  console.log(
    `Changes: https://github.com/${SOURCE_REPOSITORY}/compare/${base}...${result.commit}`,
  );
  if (request.dryRun) {
    console.log(`Dry run: ${tag} would point at ${result.commit}.`);
    return;
  }
  await run(["tag", "-a", tag, result.commit, "-m", message]);
  await run(["push", "--quiet", "origin", `refs/tags/${tag}`]);
  console.log(
    `Pushed ${tag}. The Site Release workflow uploads it; approve its approve job: https://github.com/${SOURCE_REPOSITORY}/actions/workflows/site-release.yml`,
  );
}

const epilogue = `A site release is the annotated tag site-<N> of the commit that the production docs site (${PRODUCTION_ORIGIN}) serves. Each release commit descends from the live release, and the deploy job refuses a tag that does not, so a release never drops a live change and an old job never replaces a newer site.

The live release is the tag that ${PRODUCTION_ORIGIN}${VERSION_PATH} names. Modes:
  --pick <pr...>      the live site plus the commits of these record PRs, which ${MAIN} must hold, cherry-picked in main's order
  --to [commit]       the content of this commit of ${MAIN} (default: its tip); refused when it lacks a commit that is live
  --revert-to <tag>   the content of an earlier site release, on top of the live one
  --bootstrap         the first release, when no release is live; with --to

The command fetches ${MAIN} and the tags, pushes the new tag, and prints the compare link. The Site Release workflow (.github/workflows/site-release.yml) builds the tag, uploads it as a Worker version with a version URL, and deploys it after the maintainer approves the approve job of the production environment. --dry-run prints the tag message and pushes nothing.`;

await yargs(hideBin(process.argv))
  .scriptName("site:release")
  .usage(
    "pnpm site:release --pick <pr...> | --to [commit] | --revert-to <site-tag> [--bootstrap] [--dry-run]",
  )
  .option("pick", {
    type: "number",
    array: true,
    describe: "record PR numbers",
  })
  .option("to", { type: "string", describe: `a commit of ${MAIN}` })
  .option("revert-to", { type: "string", describe: "an earlier site tag" })
  .option("bootstrap", { type: "boolean" })
  .option("dry-run", { type: "boolean", default: false })
  .conflicts("pick", ["to", "revert-to", "bootstrap"])
  .conflicts("revert-to", ["to", "bootstrap"])
  .check((argv) => {
    if (
      argv.pick === undefined &&
      argv.revertTo === undefined &&
      argv.to === undefined &&
      !argv.bootstrap
    ) {
      throw new Error("Name a mode: --pick, --to, or --revert-to.");
    }
    if (argv.pick !== undefined && argv.pick.length === 0) {
      throw new Error("--pick takes at least one record PR number.");
    }
    return true;
  })
  .command(
    "$0",
    "release the production docs site",
    () => {},
    async (argv) => {
      await release({
        pick: argv.pick,
        to: argv.to === "" ? undefined : argv.to,
        revertTo: argv.revertTo,
        bootstrap: argv.bootstrap ?? false,
        dryRun: argv.dryRun,
      });
    },
  )
  .epilogue(epilogue)
  .strict()
  .version(false)
  .wrap(null)
  .fail((message, error) => {
    console.error(error instanceof Error ? error.message : message);
    process.exit(1);
  })
  .help()
  .parseAsync();
