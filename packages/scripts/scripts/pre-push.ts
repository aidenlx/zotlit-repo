#!/usr/bin/env node

import type { PushRef } from "#push-refs";
import { text } from "node:stream/consumers";
import { $ } from "zx";

import {
  attributionLines,
  isAgentBranch,
  isAgentEnvironment,
  isAgentIdentity,
} from "#ai-attribution";
import { isLandTurn, LAND_TURN_ENV } from "#land-queue";
import { parsePushRefs, pushProblems } from "#push-refs";

const ZERO = /^0+$/;

async function attributionProblems(
  remote: string,
  refs: readonly PushRef[],
): Promise<string[]> {
  const problems: string[] = [];
  for (const { localRef, localSha, remoteRef, remoteSha } of refs) {
    if (ZERO.test(localSha)) continue;
    if (isAgentBranch(remoteRef)) {
      problems.push(`Agent branch is local-only: ${remoteRef}`);
      continue;
    }
    const range = ZERO.test(remoteSha)
      ? [localSha, "--not", `--remotes=${remote}`]
      : [`${remoteSha}..${localSha}`];
    const shas = (await $`git rev-list ${range}`.quiet()).stdout
      .split("\n")
      .filter(Boolean);
    for (const sha of shas) {
      const out = (
        await $`git log -1 --format=${"%an%x00%ae%x00%cn%x00%ce%x00%s%x00%B"} ${sha}`.quiet()
      ).stdout;
      const [an = "", ae = "", cn = "", ce = "", subject = "", ...body] =
        out.split("\0");
      const credited =
        isAgentIdentity(an, ae) ||
        isAgentIdentity(cn, ce) ||
        attributionLines(body.join("\0")).length > 0;
      if (credited) {
        problems.push(
          `${sha.slice(0, 9)} credits an AI agent (${localRef}): ${subject}`,
        );
      }
    }
  }
  if (problems.length) {
    problems.push(
      "Rewrite those commits without the attribution, and keep agent branches local.",
    );
  }
  return problems;
}

const remote = process.argv[2] ?? "";
const refs = parsePushRefs(await text(process.stdin));
const problems = pushProblems(refs, {
  agent: isAgentEnvironment(process.env),
  land: await isLandTurn(process.env[LAND_TURN_ENV]),
});
if (!problems.length) {
  problems.push(...(await attributionProblems(remote, refs)));
}

if (problems.length) {
  console.error(`\n${problems.join("\n")}\n`);
  process.exitCode = 1;
}
