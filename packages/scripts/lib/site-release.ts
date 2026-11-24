import { regex } from "arkregex";
import { execFile } from "node:child_process";
import * as v from "valibot";

export const SITE_TAG_PREFIX = "site-";
export const PRODUCTION_WORKER = "zotlit-docs";
export const PRODUCTION_ORIGIN = "https://zotlit.aidenlx.site";
export const VERSION_PATH = "/version.json";

const SITE_TAG = regex("^site-(?<n>[1-9]\\d*)$");
const PICK_TRAILER = regex(
  "\\(cherry picked from commit (?<sha>[0-9a-f]{40})\\)",
  "g",
);

export function pickedFrom(body: string): string | undefined {
  return [...body.matchAll(PICK_TRAILER)].at(-1)?.groups?.sha;
}

export type SiteMode = "pick" | "sync" | "revert" | "bootstrap";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Git = (args: readonly string[]) => Promise<GitResult>;

export function gitIn(cwd: string): Git {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        "git",
        [...args],
        { cwd, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code =
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1;
          resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        },
      );
    });
}

async function out(git: Git, args: readonly string[]): Promise<string> {
  const result = await git(args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

export function siteTagNumber(tag: string): number | undefined {
  const match = SITE_TAG.exec(tag);
  return match ? Number(match.groups.n) : undefined;
}

export function nextSiteTag(tags: Iterable<string>): string {
  let max = 0;
  for (const tag of tags) max = Math.max(max, siteTagNumber(tag) ?? 0);
  return `${SITE_TAG_PREFIX}${max + 1}`;
}

export async function isAncestor(
  git: Git,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const result = await git([
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant,
  ]);
  if (result.code > 1) {
    throw new Error(`git merge-base --is-ancestor failed: ${result.stderr}`);
  }
  return result.code === 0;
}

export async function commitOf(git: Git, ref: string): Promise<string> {
  return await out(git, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

async function treeOf(git: Git, commit: string): Promise<string> {
  return await out(git, ["rev-parse", `${commit}^{tree}`]);
}

async function commitTree(
  git: Git,
  {
    tree,
    parents,
    message,
  }: { tree: string; parents: readonly string[]; message: string },
): Promise<string> {
  return await out(git, [
    "commit-tree",
    tree,
    ...parents.flatMap((parent) => ["-p", parent]),
    "-m",
    message,
  ]);
}

export interface Pick {
  sha: string;
  subject: string;
}

export interface PickPlan {
  pending: string[];
  live: string[];
}

export async function planPicks(
  git: Git,
  { live, main, shas }: { live: string; main: string; shas: readonly string[] },
): Promise<PickPlan> {
  for (const sha of shas) {
    if (!(await isAncestor(git, sha, main))) {
      throw new Error(
        `${sha.slice(0, 12)} is not on main. Land the change first: the site serves only changes that main holds.`,
      );
    }
  }
  const wanted = new Set(shas);
  const pending = (
    await out(git, ["rev-list", "--reverse", main, "--not", live])
  )
    .split("\n")
    .filter((sha) => wanted.has(sha));
  return { pending, live: shas.filter((sha) => !pending.includes(sha)) };
}

export interface PickResult {
  commit: string;
  picked: Pick[];
  contained: Pick[];
}

export async function pickOnto(
  git: Git,
  base: string,
  shas: readonly string[],
): Promise<PickResult> {
  let head = base;
  const picked: Pick[] = [];
  const contained: Pick[] = [];
  for (const sha of shas) {
    const subject = await out(git, ["log", "-1", "--format=%s", sha]);
    const merge = await git([
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      "--merge-base",
      `${sha}^`,
      head,
      sha,
    ]);
    const [tree = "", ...conflicts] = merge.stdout.split("\n").filter(Boolean);
    if (merge.code !== 0) {
      throw new Error(
        `${sha.slice(0, 12)} (${subject}) conflicts with the live site in: ${conflicts.join(", ") || merge.stderr}. It depends on a change the live site lacks: pick that change too, or release with --to once main is ready.`,
      );
    }
    if (tree === (await treeOf(git, head))) {
      contained.push({ sha, subject });
      continue;
    }
    const body = await out(git, ["log", "-1", "--format=%B", sha]);
    head = await commitTree(git, {
      tree,
      parents: [head],
      message: `${body}\n\n(cherry picked from commit ${sha})`,
    });
    picked.push({ sha, subject });
  }
  return { commit: head, picked, contained };
}

export interface SyncResult {
  commit: string;
  lost: Pick[];
  reverts: Pick[];
}

export async function syncTo(
  git: Git,
  { live, target, main }: { live: string; target: string; main: string },
): Promise<SyncResult> {
  if (await isAncestor(git, live, target)) {
    return { commit: target, lost: [], reverts: [] };
  }
  const onlyLive = (await out(git, ["rev-list", live, "--not", target]))
    .split("\n")
    .filter(Boolean);
  const lost: Pick[] = [];
  const reverts: Pick[] = [];
  for (const sha of onlyLive) {
    const body = await out(git, ["log", "-1", "--format=%B", sha]);
    const subject = body.split("\n")[0] ?? "";
    if (await isAncestor(git, sha, main)) {
      lost.push({ sha, subject });
      continue;
    }
    const original = pickedFrom(body);
    if (original !== undefined) {
      if (!(await isAncestor(git, original, target))) {
        lost.push({ sha: original, subject });
      }
      continue;
    }
    if (body.includes("\nSite-Revert: ")) reverts.push({ sha, subject });
  }
  const commit = await commitTree(git, {
    tree: await treeOf(git, target),
    parents: [live, target],
    message: `Sync the site to main at ${target.slice(0, 12)}`,
  });
  return { commit, lost, reverts };
}

export async function revertTo(
  git: Git,
  live: string,
  tag: string,
): Promise<string> {
  const target = await commitOf(git, tag);
  return await commitTree(git, {
    tree: await treeOf(git, target),
    parents: [live],
    message: `Serve the content of ${tag} again\n\nSite-Revert: ${tag}`,
  });
}

export function tagMessage(fields: {
  tag: string;
  mode: SiteMode;
  live: string | undefined;
  main: string;
  picks: readonly Pick[];
}): string {
  return [
    fields.tag,
    "",
    `Mode: ${fields.mode}`,
    `Live: ${fields.live ?? "none"}`,
    `Main: ${fields.main}`,
    ...fields.picks.map((pick) => `Pick: ${pick.sha} ${pick.subject}`),
    "",
  ].join("\n");
}

export function tagMode(message: string): SiteMode | undefined {
  const mode = regex("^Mode: (?<mode>pick|sync|revert|bootstrap)$", "m").exec(
    message,
  )?.groups.mode;
  return mode;
}

export type DeployVerdict =
  | { ok: true; reason: string }
  | { ok: false; reason: string };

export async function deployVerdict(
  git: Git,
  fields: { tag: string; live: string | undefined },
): Promise<DeployVerdict> {
  const { tag, live } = fields;
  if (live === tag) return { ok: false, reason: `${tag} is already live.` };
  const mode = tagMode(
    await out(git, ["tag", "-l", "--format=%(contents)", tag]),
  );
  if (live === undefined || siteTagNumber(live) === undefined) {
    return mode === "bootstrap"
      ? { ok: true, reason: `${tag} bootstraps the site releases.` }
      : {
          ok: false,
          reason: `The live version carries no site tag (${live ?? "none"}). Release once with --bootstrap.`,
        };
  }
  if (
    (await git(["rev-parse", "--verify", "--quiet", `refs/tags/${live}`]))
      .code !== 0
  ) {
    return {
      ok: false,
      reason: `The live tag ${live} is missing from this clone.`,
    };
  }
  return (await isAncestor(git, live, tag))
    ? { ok: true, reason: `${tag} descends from the live ${live}.` }
    : {
        ok: false,
        reason: `${tag} does not descend from the live ${live}: it would drop changes that are live. Release again from the live site.`,
      };
}

const versionDocument = v.object({ tag: v.nullable(v.string()) });

export function parseVersionDocument(input: unknown): string | undefined {
  const parsed = v.safeParse(versionDocument, input);
  return parsed.success ? (parsed.output.tag ?? undefined) : undefined;
}

const deploymentsResponse = v.object({
  result: v.object({
    deployments: v.array(
      v.object({
        versions: v.array(
          v.object({ version_id: v.string(), percentage: v.number() }),
        ),
      }),
    ),
  }),
});

const versionResponse = v.object({
  result: v.object({
    annotations: v.optional(
      v.object({ "workers/tag": v.optional(v.string()) }),
    ),
  }),
});

export interface Cloudflare {
  accountId: string;
  token: string;
  worker: string;
  fetch?: typeof fetch;
}

async function cloudflare(
  api: Cloudflare,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await (api.fetch ?? fetch)(
    `https://api.cloudflare.com/client/v4/accounts/${api.accountId}/workers/scripts/${api.worker}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${api.token}`,
        "content-type": "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Cloudflare ${init?.method ?? "GET"} ${path} answered ${response.status}: ${await response.text()}`,
    );
  }
  return await response.json();
}

export async function liveVersion(
  api: Cloudflare,
): Promise<{ versionId: string; tag: string | undefined }> {
  const { result } = v.parse(
    deploymentsResponse,
    await cloudflare(api, "/deployments"),
  );
  const versions = result.deployments[0]?.versions ?? [];
  const only = versions[0];
  if (versions.length !== 1 || only === undefined || only.percentage !== 100) {
    throw new Error(
      `The live deployment of ${api.worker} splits traffic (${JSON.stringify(versions)}). Finish or roll back that gradual deployment first.`,
    );
  }
  const version = v.parse(
    versionResponse,
    await cloudflare(api, `/versions/${only.version_id}`),
  );
  return {
    versionId: only.version_id,
    tag: version.result.annotations?.["workers/tag"],
  };
}

export async function versionTag(
  api: Cloudflare,
  versionId: string,
): Promise<string | undefined> {
  const version = v.parse(
    versionResponse,
    await cloudflare(api, `/versions/${versionId}`),
  );
  return version.result.annotations?.["workers/tag"];
}

export async function deployVersion(
  api: Cloudflare,
  versionId: string,
  message: string,
): Promise<void> {
  await cloudflare(api, "/deployments", {
    method: "POST",
    body: JSON.stringify({
      strategy: "percentage",
      versions: [{ version_id: versionId, percentage: 100 }],
      annotations: { "workers/message": message.slice(0, 1000) },
    }),
  });
}
