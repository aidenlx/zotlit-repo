import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

export function scanFirstCommitDays(
  packageRoot: string,
): Record<string, string> {
  let shallow: string;
  let log: string;
  try {
    shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: packageRoot,
      encoding: "utf8",
    }).trim();
    log = execFileSync(
      "git",
      [
        "-c",
        "core.quotepath=off",
        "log",
        "--reverse",
        "--relative",
        "-M",
        "--name-status",
        "--date=format-local:%Y-%m-%d",
        "--format=commit:%ad",
        "--",
        "content",
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, TZ: "UTC" },
      },
    );
  } catch (cause) {
    throw new Error(
      `Pages' first commit days need the git history of ${packageRoot}/content`,
      { cause },
    );
  }
  if (shallow === "true") {
    throw new Error(
      "Pages' first commit days need the whole git history, and this clone is shallow. Run `git fetch --unshallow`, or check out with `fetch-depth: 0`.",
    );
  }

  const days = new Map<string, string>();
  let day = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("commit:")) {
      day = line.slice("commit:".length);
      continue;
    }
    const [status = "", from = "", to] = line.split("\t");
    if (status.startsWith("R") && to !== undefined) {
      days.set(to, days.get(from) ?? day);
      days.delete(from);
    } else if (status === "D") {
      days.delete(from);
    } else if (from && !days.has(from)) {
      days.set(from, day);
    }
  }

  return Object.fromEntries(
    [...days]
      .filter(([path]) => path.startsWith("content/"))
      .map(([path, first]) => [path.slice("content/".length), first]),
  );
}

export function firstCommitsPlugin(packageRoot: string): Plugin {
  return {
    name: "zotlit:first-commits",
    config() {
      return {
        define: {
          __FIRST_COMMIT_DAYS__: JSON.stringify(
            scanFirstCommitDays(packageRoot),
          ),
        },
      };
    },
  };
}
