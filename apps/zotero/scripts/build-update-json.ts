import { Eta } from "eta/core";
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gt, prerelease } from "semver";

import {
  HOST_NOTES,
  UPDATE_BETA_JSON,
  UPDATE_JSON,
  xpiDownloadUrl,
  xpiName,
} from "./release-constants.ts";

interface UpdateManifest {
  addons: Record<
    string,
    {
      updates: Array<{
        version: string;
        update_link: string;
        update_hash: string;
        applications: {
          zotero: {
            strict_min_version?: string;
            strict_max_version?: string;
          };
        };
      }>;
    }
  >;
}

const packageRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = join(packageRoot, "package.json");
const distDir = join(packageRoot, "dist");

const pkg = JSON.parse(await readFile(packageJsonPath, "utf-8")) as {
  version: string;
  zotero: {
    id: string;
    strict_min_version?: string;
    strict_max_version?: string;
  };
};

const { version, zotero } = pkg;

const xpiPath = join(distDir, xpiName(version));
const hash = createHash("sha512")
  .update(await readFile(xpiPath))
  .digest("hex");

const manifest: UpdateManifest = {
  addons: {
    [zotero.id]: {
      updates: [
        {
          version,
          update_link: xpiDownloadUrl(version),
          update_hash: `sha512:${hash}`,
          applications: {
            zotero: {
              ...(zotero.strict_min_version && {
                strict_min_version: zotero.strict_min_version,
              }),
              ...(zotero.strict_max_version && {
                strict_max_version: zotero.strict_max_version,
              }),
            },
          },
        },
      ],
    },
  },
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const isPrerelease = prerelease(version) !== null;

const written: string[] = [];

if (await writeIfNewer(UPDATE_BETA_JSON, serialized)) {
  written.push(UPDATE_BETA_JSON);
}
if (!isPrerelease && (await writeIfNewer(UPDATE_JSON, serialized))) {
  written.push(UPDATE_JSON);
}

await writeFile(join(distDir, HOST_NOTES), await renderHostNotes(written));
await emitAttestPaths(written);

const channels = written.length
  ? written.join(" + ")
  : "no channels (existing entries newer)";
console.log(`Wrote ${channels} + ${HOST_NOTES} for ${zotero.id}@${version}`);

async function writeIfNewer(file: string, body: string): Promise<boolean> {
  const existing = await readEntryVersion(file);
  if (existing && !gt(version, existing)) return false;
  await writeFile(join(distDir, file), body);
  return true;
}

async function readEntryVersion(file: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(join(distDir, file), "utf-8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as UpdateManifest;
  return parsed.addons?.[zotero.id]?.updates?.[0]?.version ?? null;
}

async function emitAttestPaths(rewritten: string[]): Promise<void> {
  const outFile = process.env.GITHUB_OUTPUT;
  if (!outFile) return;
  const rel = (f: string): string => `apps/zotero/dist/${f}`;
  const paths = [rel(xpiName(version)), ...rewritten.map(rel)];
  await appendFile(outFile, `attest<<EOF\n${paths.join("\n")}\nEOF\n`);
}

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

async function renderHostNotes(rewritten: string[]): Promise<string> {
  const eta = new Eta();
  const template = await readFile(
    join(packageRoot, "scripts", "release-host-notes.eta"),
    "utf-8",
  );
  const refreshed = rewritten.length
    ? `${rewritten.map((f) => `\`${f}\``).join(" + ")}`
    : "no channels (existing entries were newer)";
  const compat = zotero.strict_max_version
    ? `${zotero.strict_min_version} – ${zotero.strict_max_version}`
    : zotero.strict_min_version
      ? `${zotero.strict_min_version}+`
      : null;

  return eta.renderString(template, {
    updateJson: UPDATE_JSON,
    updateBetaJson: UPDATE_BETA_JSON,
    addonId: zotero.id,
    compat,
    version,
    refreshedAt: Temporal.Now.instant().toString({
      smallestUnit: "millisecond",
    }),
    refreshed,
  });
}
