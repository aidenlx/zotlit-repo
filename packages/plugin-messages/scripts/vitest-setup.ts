import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export default function setup(): void {
  execFileSync(process.execPath, ["scripts/generate-language-packs.ts"], {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "ignore", "inherit"],
  });
}
