import { execFileSync } from "node:child_process";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const BUILD_COMMAND = "npx gulp zotlit-dist";
const BUILD_OUTPUT = join("build", "zotlit");
const TAG_PATTERN = "v*-zotlit.*";
const DECODER_LICENSES = [
  "LICENSE_JBIG2",
  "LICENSE_PDFJS_JBIG2",
  "LICENSE_OPENJPEG",
  "LICENSE_PDFJS_OPENJPEG",
];

const packageRoot = resolve(import.meta.dirname, "..");
const callerDir = process.env.INIT_CWD ?? process.cwd();

function fail(message: string): never {
  console.error(`vendor: ${message}`);
  process.exit(1);
}

function vendor(forkDir: string) {
  function git(...args: string[]): string {
    return execFileSync("git", ["-C", forkDir, ...args], {
      encoding: "utf8",
    }).trim();
  }

  const lines = (output: string) => (output === "" ? [] : output.split("\n"));

  if (git("status", "--porcelain") !== "") {
    fail(`${forkDir} has uncommitted changes`);
  }

  const [tag] = lines(
    git(
      "tag",
      "--points-at",
      "HEAD",
      "--sort=-v:refname",
      "--list",
      TAG_PATTERN,
    ),
  );
  if (tag === undefined) {
    fail(`HEAD of ${forkDir} has no ${TAG_PATTERN} tag`);
  }

  const upstreamTag = tag.slice(0, tag.lastIndexOf("-zotlit."));
  const branch =
    git("branch", "--show-current") ||
    lines(
      git(
        "for-each-ref",
        "--points-at",
        "HEAD",
        "--format=%(refname:short)",
        "refs/heads",
      ),
    )[0] ||
    null;
  const commit = git("rev-parse", "HEAD");
  const patches = lines(
    git("log", "--reverse", "--format=%H%x09%s", `${upstreamTag}..HEAD`),
  ).map((line) => {
    const [sha = "", subject = ""] = line.split("\t");
    return { sha, subject };
  });
  const modifiedFiles = lines(
    git("diff", "--name-only", upstreamTag, "HEAD"),
  ).sort();

  const buildDir = join(forkDir, BUILD_OUTPUT);

  const distDir = join(packageRoot, "dist");
  rmSync(distDir, { recursive: true, force: true });
  cpSync(buildDir, distDir, { recursive: true });

  cpSync(join(forkDir, "LICENSE"), join(packageRoot, "LICENSE"));
  for (const name of DECODER_LICENSES) {
    cpSync(join(buildDir, "wasm", name), join(packageRoot, name));
  }

  const home = homedir();
  const provenance = {
    fork: forkDir.startsWith(home + sep)
      ? join("~", relative(home, forkDir))
      : forkDir,
    branch,
    tag,
    commit,
    upstreamTag,
    patches,
    modifiedFiles,
    buildCommand: BUILD_COMMAND,
    vendoredAt: Temporal.Now.instant().toString({ smallestUnit: "second" }),
  };
  writeFileSync(
    join(packageRoot, "provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );

  console.log(`vendor: copied ${tag} (${commit}) from ${forkDir}`);
}

await yargs(hideBin(process.argv))
  .scriptName("vendor.ts")
  .command(
    "$0 <fork>",
    "Copy the pdf.js-zotlit build from a local fork checkout into dist/",
    (y) =>
      y.positional("fork", {
        describe:
          "path to the pdf.js-zotlit checkout; a relative path resolves from the folder where you run pnpm",
        type: "string",
        demandOption: true,
      }),
    (argv) => vendor(resolve(callerDir, argv.fork)),
  )
  .epilogue(
    [
      `Build the fork first with '${BUILD_COMMAND}'. This script runs no build.`,
      `It refuses a fork with uncommitted changes, and a fork HEAD with no ${TAG_PATTERN} tag.`,
      `It replaces dist/ with <fork>/${BUILD_OUTPUT}, copies the fork LICENSE and ${DECODER_LICENSES.join(", ")} (from <fork>/${BUILD_OUTPUT}/wasm) to the package root, and writes provenance.json: fork, branch, tag, commit, upstream tag, patches, modified files, build command and time.`,
    ].join("\n"),
  )
  .strict()
  .version(false)
  .parse();
