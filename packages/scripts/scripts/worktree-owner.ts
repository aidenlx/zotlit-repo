#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CREATION_WINDOW_MS,
  isNewWorktree,
  isOwner,
  ownerMark,
  refusal,
} from "#worktree-owner";

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const ownerFile = (admin: string) => join(admin, "zotlit-owner.json");

function mark(): string | undefined {
  const admin = git("rev-parse", "--absolute-git-dir");
  const owner = ownerMark(process.env);
  if (!owner) return "no session identifier is set";
  if (
    !isNewWorktree(
      statSync(admin).birthtimeMs,
      Temporal.Now.instant().epochMilliseconds,
    )
  ) {
    return `the worktree was not created in the last ${CREATION_WINDOW_MS / 1000} s`;
  }
  try {
    writeFileSync(ownerFile(admin), `${JSON.stringify(owner)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return undefined;
}

const command = process.argv[2];
if (command === "mark") {
  let reason: string | undefined;
  try {
    reason = mark();
  } catch (error) {
    reason = (error as Error).message.split("\n")[0];
  }
  if (reason)
    console.error(`warning: wrote no owner mark for this worktree: ${reason}`);
} else if (command === "check") {
  let owner: unknown;
  try {
    owner = JSON.parse(
      readFileSync(ownerFile(git("rev-parse", "--absolute-git-dir")), "utf8"),
    );
  } catch {
    owner = undefined;
  }
  if (!isOwner(owner, process.env)) {
    console.error(
      refusal(
        git("rev-parse", "--show-toplevel"),
        git("branch", "--show-current"),
      ),
    );
    process.exit(1);
  }
} else {
  console.error("Usage: worktree-owner.ts mark|check");
  process.exit(2);
}
