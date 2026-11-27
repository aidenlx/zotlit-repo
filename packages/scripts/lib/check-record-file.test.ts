import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

import { LAND_RECORD_ENV } from "./land.ts";

const script = resolve(import.meta.dirname, "../scripts/check-record-file.ts");
const folder = await mkdtemp(join(tmpdir(), "check-record-file-"));
afterAll(() => rm(folder, { recursive: true, force: true }));

async function check(path: string) {
  try {
    const { stdout, stderr } = await promisify(execFile)("node", [script], {
      env: { ...process.env, [LAND_RECORD_ENV]: path },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code: number;
      stdout: string;
      stderr: string;
    };
    return { code, stdout, stderr };
  }
}

describe("the Record file step of pnpm verify", () => {
  it("fails with the land's message when the record has no e2e section", async () => {
    const path = join(folder, "incomplete.md");
    await writeFile(
      path,
      "# feat: a\n\n## Summary\n\n## Testing\n\n## Risk\n\n## How to revert\n\n## Review\n\n## Open points\n",
    );

    const result = await check(path);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "error[preflight]: The record file .scratch/land-record.md is not complete: it has no ## e2e section.",
    );
  });

  it("inside a land, leaves the title to the land, which checks it only for a squash", async () => {
    const path = join(folder, "no-squash.md");
    await writeFile(
      path,
      "# Add a\n\n## Summary\n\n## Testing\n\n## Risk\n\n## How to revert\n\n## Review\n\n## Open points\n\n## e2e\n",
    );

    expect((await check(path)).code).toBe(0);
  });

  it("prints one line and passes when there is no record file yet", async () => {
    const result = await check(join(folder, "absent.md"));

    expect(result.code).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      expect.stringContaining("no record file yet"),
    ]);
  });
});
