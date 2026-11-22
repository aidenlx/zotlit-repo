import { env } from "cloudflare:workers";
import { compare, lt, valid } from "semver";

import { zotlitBetaUrl } from "./shared.ts";
import { changelog } from "./source.ts";

interface ReleasePaths {
  release: string;
  changelog: string;
}

function betaFallbackUrl(path: string): string | undefined {
  if (env.DOCS_LINE === "beta") return undefined;
  return `${zotlitBetaUrl}${path}`;
}

function predatesChangelog(version: string): boolean {
  const [first] = changelog
    .getPages("en")
    .map((page) => page.data.version)
    .toSorted(compare);
  return valid(version) !== null && first !== undefined && lt(version, first);
}

export function missingReleaseRedirect(
  version: string,
  paths: ReleasePaths,
): { href: string; status: 307 | 308 } | undefined {
  if (predatesChangelog(version)) return { href: paths.changelog, status: 308 };
  const href = betaFallbackUrl(paths.release);
  return href === undefined ? undefined : { href, status: 307 };
}

export function missingReleaseResponse(
  version: string,
  paths: ReleasePaths,
): Response {
  const target = missingReleaseRedirect(version, paths);
  return target === undefined
    ? new Response("Not found", { status: 404 })
    : new Response(null, {
        status: target.status,
        headers: { location: target.href },
      });
}
