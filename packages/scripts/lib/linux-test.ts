import { isAbsolute, normalize } from "node:path";

import { OBSIDIAN_RUNTIME_VERSION } from "./obsidian-runtime.ts";

export const EXIT_USAGE = 2;

export const LINUX_TEST_HELP = `pnpm test:linux <package folder> <test file>...

Runs Vitest files of one package on Linux, in the Run Container image, and exits with the Vitest exit code. Test files are relative to the package folder.

  pnpm test:linux packages/pdf-reader src/core/find/find.test.ts

The guest copies the tracked and unignored worktree files, keeps its Linux node_modules in the volume zotlit-test-linux-<arch>-u<uid> (installed from the Run Container's pnpm store), runs the turbo prerequisites of the test task, and extracts the Obsidian ${OBSIDIAN_RUNTIME_VERSION} runtime from the image once. A file that imports the electron-renderer helper gets an Xvfb display and ZOTLIT_TEST_ELECTRON_PATH; the first such run downloads the pinned Electron into the volume.

It does not reproduce: the Ubuntu x86_64 runner (the image is Debian, on the host architecture, with other timings); the Electron sandbox (the guest sets ELECTRON_DISABLE_SANDBOX=1); turbo's strict environment, shards and the Memory Gate of pnpm verify --pr; mise, wt and the git history. It takes file paths only, no Vitest options. Run one call at a time: all calls share the volume.

Exit codes:
  0      the tests passed
  1      a test failed
  ${EXIT_USAGE}      usage error
  other  the exit code of Vitest, the guest set-up or docker`;

export type LinuxTestArgs =
  | { kind: "help" }
  | { kind: "usage"; message: string }
  | { kind: "run"; pkg: string; files: string[] };

export function parseLinuxTestArgs(argv: readonly string[]): LinuxTestArgs {
  if (argv.some((arg) => arg === "--help" || arg === "-h"))
    return { kind: "help" };
  const option = argv.find((arg) => arg.startsWith("-"));
  if (option)
    return {
      kind: "usage",
      message: `${option} is an option; pass a package folder and test file paths only.`,
    };
  const [first, ...files] = argv;
  if (!first || files.length === 0)
    return {
      kind: "usage",
      message: "Pass a package folder and at least one test file.",
    };
  const normalized = normalize(first);
  const pkg = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  if (isAbsolute(pkg) || pkg === ".." || pkg.startsWith("../"))
    return {
      kind: "usage",
      message: `The package folder ${first} is outside the workspace; pass it relative to the workspace root.`,
    };
  return { kind: "run", pkg, files };
}

export function usesElectron(source: string): boolean {
  return source.includes("electron-renderer");
}

export function linuxTestDockerArgs(options: {
  image: string;
  arch: string;
  uid: number;
  gid: number;
  workspaceRoot: string;
  pkg: string;
  files: readonly string[];
  electron: boolean;
  name: string;
}): string[] {
  return [
    "run",
    "--rm",
    "--init",
    "--interactive",
    "--user",
    `${options.uid}:${options.gid}`,
    "--group-add",
    "1000",
    "--memory=4g",
    "--shm-size=1g",
    "--name",
    options.name,
    "--mount",
    `type=bind,source=${options.workspaceRoot},target=/source,readonly`,
    "--mount",
    `type=volume,source=zotlit-test-linux-${options.arch}-u${options.uid},target=/workspace/worktree`,
    "--mount",
    `type=volume,source=zotlit-e2e-pnpm-${options.arch}-u${options.uid},target=/pnpm-store`,
    "--env",
    `ZOTLIT_LINUX_TEST_PACKAGE=${options.pkg}`,
    "--env",
    `ZOTLIT_LINUX_TEST_ELECTRON=${options.electron ? 1 : 0}`,
    "--env",
    `ZOTLIT_OBSIDIAN_RUNTIME=${OBSIDIAN_RUNTIME_VERSION}`,
    "--entrypoint",
    "bash",
    options.image,
    "-c",
    GUEST_SCRIPT,
    "linux-test",
    ...options.files,
  ];
}

const GUEST_SCRIPT = String.raw`set -euo pipefail
mkdir -m 700 -p "$HOME"
git config --global --add safe.directory "$PWD"
cat >/tmp/files
rm -rf .git
find . -mindepth 1 \( -name node_modules -o -name .turbo \) -prune -o ! -type d -print0 | xargs -0 rm -f
tar --create --directory=/source --no-recursion --null --files-from=/tmp/files | tar --extract --no-same-owner
git init -q
git add -f --pathspec-from-file=/tmp/files --pathspec-file-nul
pnpm install --frozen-lockfile --prefer-offline --store-dir=/pnpm-store >/tmp/install.log 2>&1 || { cat /tmp/install.log >&2; exit 1; }
export ZOTLIT_TOOLCHAIN="node-$(node --version)" TURBO_TELEMETRY_DISABLED=1
runtime="node_modules/.ob-rev-$ZOTLIT_OBSIDIAN_RUNTIME"
asar=/opt/obsidian/resources/obsidian.asar
skill=.agents/skills/obsidian-asar-extract
if [[ ! -f "$runtime/app.js" && -f "$asar" && "$(node "$skill/probe-version.mjs" --asar "$asar")" == "$ZOTLIT_OBSIDIAN_RUNTIME" ]]; then
  node "$skill/extract.mjs" --asar "$asar" >/tmp/extract.log 2>&1 || { cat /tmp/extract.log >&2; exit 1; }
fi
prerequisites=$(pnpm exec turbo run test --filter="./$ZOTLIT_LINUX_TEST_PACKAGE" --dry-run=json |
  node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).tasks.filter((t) => t.command !== "<NONEXISTENT>" && !(t.task === "test" && t.directory === process.argv[1])).map((t) => t.taskId).join(" ")))' "$ZOTLIT_LINUX_TEST_PACKAGE")
if [[ -n "$prerequisites" ]]; then
  pnpm exec turbo run $prerequisites --output-logs=errors-only
fi
if [[ "$ZOTLIT_LINUX_TEST_ELECTRON" == 1 ]]; then
  ZOTLIT_TEST_ELECTRON_PATH=$(cd apps/obsidian && node -e 'require("electron")' >&2 && node -p 'require("electron")')
  export ZOTLIT_TEST_ELECTRON_PATH ELECTRON_DISABLE_SANDBOX=1
  mkdir -m 700 -p "$XDG_RUNTIME_DIR"
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -noreset >/tmp/display.log 2>&1 &
  for ((attempt=0; attempt<100; attempt++)); do
    if xwd -root -silent -out /dev/null >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
fi
cd "$ZOTLIT_LINUX_TEST_PACKAGE"
exec pnpm exec vitest run "$@"`;
