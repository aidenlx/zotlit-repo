import { execFile } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function purgeVault(abs: string): Promise<void> {
  if (
    !(await access(abs).then(
      () => true,
      () => false,
    ))
  ) {
    console.error(`no vault folder at ${abs}`);
    return;
  }

  await access(join(abs, ".obsidian")).catch(() => {
    throw new Error(`refusing to purge a folder with no .obsidian: ${abs}`);
  });

  let tracked = "";
  try {
    ({ stdout: tracked } = await execFileAsync("git", ["ls-files", "--", "."], {
      cwd: abs,
      windowsHide: true,
    }));
  } catch (error) {
    const result = error as { code?: unknown; stderr?: string };
    if (!/not a git repository/i.test(result.stderr ?? "")) {
      throw new Error(
        `could not check tracked files in ${abs}: ${result.stderr?.trim() || `git exited ${String(result.code)}`}`,
      );
    }
  }
  if (tracked.trim()) {
    throw new Error(
      `refusing to purge a folder holding git-tracked files: ${abs}`,
    );
  }

  await rm(abs, { recursive: true, force: true });
  console.error(`deleted folder ${abs}`);
}
