import { createHash } from "node:crypto";

export function snapshotRevision(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
