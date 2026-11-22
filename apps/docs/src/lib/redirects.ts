import type { RedirectRule } from "./v1-redirects.ts";
import { buildV1Redirects, renderRedirectsFile } from "./v1-redirects.ts";
import { buildV2Redirects, V2_MOVES } from "./v2-redirects.ts";

export function buildRedirects(moves = V2_MOVES): RedirectRule[] {
  return [...buildV2Redirects(moves), ...buildV1Redirects()];
}

export function renderSiteRedirectsFile(moves = V2_MOVES): string {
  return renderRedirectsFile(buildRedirects(moves));
}
