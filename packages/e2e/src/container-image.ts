import { createHash } from "node:crypto";

export function runImageTag(inputs: readonly string[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(inputs))
    .digest("hex");
  return `zotlit-e2e:${hash.slice(0, 16)}`;
}
