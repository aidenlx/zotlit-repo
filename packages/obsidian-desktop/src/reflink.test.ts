import { mkdtempDisposable, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isClonefileUnsupported, reflink } from "./reflink.ts";

describe.skipIf(process.platform !== "darwin")("reflink", () => {
  it("creates a file with the source bytes at a new path", async () => {
    await using dir = await mkdtempDisposable(
      join(tmpdir(), "zotlit-reflink-"),
    );
    const source = join(dir.path, "source.pdf");
    const newPath = join(dir.path, "copy.pdf");
    const bytes = Uint8Array.of(0, 42, 255);
    await writeFile(source, bytes);

    await reflink(source, newPath);

    expect(await readFile(newPath)).toEqual(Buffer.from(bytes));
  });
});

function execFailure(stderr: string): Error {
  return Object.assign(new Error("Command failed: cp -c -n src dest"), {
    code: 1,
    stdout: "",
    stderr,
  });
}

describe("isClonefileUnsupported", () => {
  it("classifies a clone the volume refused", () => {
    expect(
      isClonefileUnsupported(
        execFailure("cp: clonefile failed: Cross-device link\n"),
      ),
    ).toBe(true);
  });

  it("leaves other exit failures unclassified", () => {
    expect(
      isClonefileUnsupported(
        execFailure("cp: /zotero/zotero.sqlite: No such file or directory\n"),
      ),
    ).toBe(false);
  });

  it("leaves errno-carrying errors unclassified", () => {
    expect(
      isClonefileUnsupported(
        Object.assign(new Error("spawn cp ENOENT"), {
          code: "ENOENT",
          errno: -2,
          syscall: "spawn cp",
        }),
      ),
    ).toBe(false);
  });
});
