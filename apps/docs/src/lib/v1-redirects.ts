import { zotlitLegacyUrl } from "./shared.ts";
import { PAGE_MAP, V1_ONLY } from "./v1-routes.ts";

export interface RedirectRule {
  source: string;
  destination: string;
  status: 307 | 308;
}

const q = (src: string, lang?: string) =>
  `?from=v1&src=${encodeURIComponent(src)}${lang ? `&lang=${lang}` : ""}`;

const external = (path: string): RedirectRule => ({
  source: path,
  destination: `${zotlitLegacyUrl}${path}`,
  status: 308,
});

export function buildV1Redirects(): RedirectRule[] {
  const redirects: RedirectRule[] = [];

  for (const [from, to] of Object.entries(PAGE_MAP)) {
    redirects.push({
      source: from,
      destination: `${to}${q(from)}`,
      status: 308,
    });
  }

  redirects.push(...V1_ONLY.en.map(external), ...V1_ONLY.zh.map(external));

  for (const [from, to] of Object.entries(PAGE_MAP)) {
    redirects.push({
      source: `/zh-CN${from}`,
      destination: `/zh-CN${to}${q(from, "zh-CN")}`,
      status: 308,
    });
  }

  return redirects.flatMap((rule) => [
    rule,
    { ...rule, source: `${rule.source}/` },
  ]);
}

export function renderRedirectsFile(rules = buildV1Redirects()): string {
  const lines = rules.map(
    ({ source, destination, status }) => `${source} ${destination} ${status}`,
  );
  return `${lines.join("\n")}\n`;
}
