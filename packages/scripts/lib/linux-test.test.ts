import { describe, expect, it } from "vitest";

import {
  linuxTestDockerArgs,
  parseLinuxTestArgs,
  usesElectron,
} from "./linux-test.ts";

describe("parseLinuxTestArgs", () => {
  it("reads a package folder and its test files", () => {
    expect(
      parseLinuxTestArgs(["packages/pdf-reader", "src/core/find/find.test.ts"]),
    ).toEqual({
      kind: "run",
      pkg: "packages/pdf-reader",
      files: ["src/core/find/find.test.ts"],
    });
  });

  it("drops a trailing slash and a leading ./ of the package folder", () => {
    expect(parseLinuxTestArgs(["./packages/scripts/", "a.test.ts"])).toEqual({
      kind: "run",
      pkg: "packages/scripts",
      files: ["a.test.ts"],
    });
  });

  it("gives help for --help and -h", () => {
    expect(parseLinuxTestArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseLinuxTestArgs(["packages/scripts", "-h"])).toEqual({
      kind: "help",
    });
  });

  it("refuses a call without a test file", () => {
    expect(parseLinuxTestArgs([])).toMatchObject({ kind: "usage" });
    expect(parseLinuxTestArgs(["packages/scripts"])).toMatchObject({
      kind: "usage",
    });
  });

  it("refuses a package folder outside the workspace", () => {
    expect(parseLinuxTestArgs(["../other", "a.test.ts"])).toMatchObject({
      kind: "usage",
    });
    expect(parseLinuxTestArgs(["/abs/pkg", "a.test.ts"])).toMatchObject({
      kind: "usage",
    });
  });

  it("refuses an option, which the command does not pass to Vitest", () => {
    expect(
      parseLinuxTestArgs(["packages/scripts", "a.test.ts", "-t", "x"]),
    ).toMatchObject({ kind: "usage" });
  });
});

describe("usesElectron", () => {
  it("finds the Electron renderer helper import", () => {
    expect(
      usesElectron(
        'import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";',
      ),
    ).toBe(true);
    expect(usesElectron('import { x } from "./electron-renderer.ts";')).toBe(
      true,
    );
  });

  it("is false for a plain Node test", () => {
    expect(usesElectron('import { it } from "vitest";')).toBe(false);
  });
});

describe("linuxTestDockerArgs", () => {
  const base = {
    image: "zotlit-e2e:abc",
    arch: "arm64",
    uid: 501,
    gid: 20,
    workspaceRoot: "/repo",
    pkg: "packages/pdf-reader",
    files: ["src/core/find/find.test.ts"],
    name: "zotlit-test-linux-1",
  };

  it("mounts the worktree read-only, keeps the guest tree and the pnpm store in named volumes, and passes the files", () => {
    const args = linuxTestDockerArgs({ ...base, electron: false });
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "--init"]);
    expect(args).toContain("--interactive");
    expect(args).toEqual(
      expect.arrayContaining([
        "--user",
        "501:20",
        "--mount",
        "type=bind,source=/repo,target=/source,readonly",
        "type=volume,source=zotlit-test-linux-arm64-u501,target=/workspace/worktree",
        "type=volume,source=zotlit-e2e-pnpm-arm64-u501,target=/pnpm-store",
        "--entrypoint",
        "bash",
        "ZOTLIT_LINUX_TEST_PACKAGE=packages/pdf-reader",
        "ZOTLIT_LINUX_TEST_ELECTRON=0",
        "NO_COLOR=1",
      ]),
    );
    const image = args.indexOf("zotlit-e2e:abc");
    expect(args[image + 1]).toBe("-c");
    expect(args.slice(image + 3)).toEqual([
      "linux-test",
      "src/core/find/find.test.ts",
    ]);
  });

  it("asks the guest for Electron and a display for a renderer test", () => {
    expect(linuxTestDockerArgs({ ...base, electron: true })).toContain(
      "ZOTLIT_LINUX_TEST_ELECTRON=1",
    );
  });
});
