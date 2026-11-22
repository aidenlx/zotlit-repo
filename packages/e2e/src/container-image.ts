import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ImageVersions {
  platform: string;
  pnpm: string;
  obsidian: string;
  zotero: string;
}

export function runImageTag(context: string, versions: ImageVersions): string {
  const inputs = [
    versions.platform,
    versions.pnpm,
    versions.obsidian,
    versions.zotero,
    readFileSync(join(context, "Dockerfile"), "utf8"),
    readFileSync(join(context, "entry.sh"), "utf8"),
  ];
  const hash = createHash("sha256")
    .update(JSON.stringify(inputs))
    .digest("hex");
  return `zotlit-e2e:${hash.slice(0, 16)}`;
}
