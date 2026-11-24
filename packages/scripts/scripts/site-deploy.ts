#!/usr/bin/env node
import type { Cloudflare } from "#site-release";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { SOURCE_REPOSITORY } from "@zotlit/config/repositories";

import { getWorkspaceRoot } from "#package-roots";
import {
  commitOf,
  deployVerdict,
  deployVersion,
  gitIn,
  liveVersion,
  PRODUCTION_WORKER,
  versionTag,
} from "#site-release";

const root = await getWorkspaceRoot(import.meta.dirname);
const git = gitIn(root);

function api(): Cloudflare {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.");
  }
  return { token, accountId, worker: PRODUCTION_WORKER };
}

async function check(tag: string, versionId: string) {
  const cloudflare = api();
  const live = await liveVersion(cloudflare);
  const uploaded = await versionTag(cloudflare, versionId);
  if (uploaded !== tag) {
    throw new Error(
      `Version ${versionId} carries the tag ${uploaded ?? "none"}, not ${tag}.`,
    );
  }
  const verdict = await deployVerdict(git, { tag, live: live.tag });
  return { cloudflare, live, verdict };
}

async function summary(tag: string, versionId: string, previewUrl: string) {
  const { live, verdict } = await check(tag, versionId);
  const commit = await commitOf(git, `refs/tags/${tag}`);
  const base = live.tag ?? "none";
  const lines = [
    `### ${tag}`,
    "",
    `- Live: ${base} (version ${live.versionId})`,
    `- Verdict: ${verdict.ok ? "deployable" : "refused"}: ${verdict.reason}`,
    `- Version URL: ${previewUrl || "none: enable Version URLs for the Worker (docs/CI_SETUP.md)"}`,
  ];
  if (live.tag !== undefined) {
    const stat = (
      await git(["diff", "--shortstat", `refs/tags/${live.tag}`, commit])
    ).stdout;
    lines.push(
      `- Changes: https://github.com/${SOURCE_REPOSITORY}/compare/${live.tag}...${tag} (${stat || "no file changes"})`,
    );
  }
  console.log(lines.join("\n"));
  if (!verdict.ok) process.exitCode = 1;
}

async function deploy(tag: string, versionId: string) {
  const { cloudflare, verdict } = await check(tag, versionId);
  if (!verdict.ok) throw new Error(verdict.reason);
  const run = process.env.GITHUB_RUN_ID
    ? ` run ${process.env.GITHUB_SERVER_URL}/${SOURCE_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "";
  await deployVersion(cloudflare, versionId, `${tag}${run}`);
  console.log(`Deployed ${tag} (version ${versionId}): ${verdict.reason}`);
}

const epilogue = `Used by .github/workflows/site-release.yml. Both commands read the live deployment of the ${PRODUCTION_WORKER} Worker from the Cloudflare API, check that the uploaded version carries the tag, and check that the tag descends from the live site release (a --bootstrap release passes when no release is live). summary prints the Markdown summary and fails on a refused tag; deploy sends the version to 100% of traffic. Credentials: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.`;

await yargs(hideBin(process.argv))
  .scriptName("site-deploy")
  .option("tag", { type: "string", demandOption: true })
  .option("version-id", { type: "string", demandOption: true })
  .command(
    "summary",
    "print the summary of an uploaded site release",
    (y) => y.option("preview-url", { type: "string", default: "" }),
    async (argv) => {
      await summary(argv.tag, argv.versionId, argv.previewUrl);
    },
  )
  .command(
    "deploy",
    "deploy an uploaded site release",
    () => {},
    async (argv) => {
      await deploy(argv.tag, argv.versionId);
    },
  )
  .demandCommand(1)
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
