import { env } from "cloudflare:workers";
import { gt, rcompare, valid } from "semver";
import * as v from "valibot";

import * as m from "@/paraglide/messages.js";

import { assetUrl, tagUrl } from "./github-releases.ts";
import type { ReleaseChannel } from "./github-releases.ts";
import { gitConfig, repoSlug } from "./shared.ts";

const ZOTERO_ADDON_ID = "zotlit@aidenlx.site";
const CACHE_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 5_000;

const API_HOST = "api.github.com";

const versionSchema = v.pipe(
  v.string(),
  v.check((version) => valid(version) !== null),
);

const releasesSchema = v.array(
  v.object({
    tag_name: v.string(),
    draft: v.boolean(),
    prerelease: v.boolean(),
    published_at: v.nullable(v.string()),
  }),
);

type GhReleases = v.InferOutput<typeof releasesSchema>;

const pluginManifestSchema = v.object({
  version: versionSchema,
  minAppVersion: v.string(),
  isDesktopOnly: v.optional(v.boolean()),
});

const companionUpdateSchema = v.object({
  version: versionSchema,
  applications: v.object({
    zotero: v.object({
      strict_min_version: v.string(),
      strict_max_version: v.optional(v.string()),
    }),
  }),
});

const companionManifestSchema = v.object({
  addons: v.object({
    [ZOTERO_ADDON_ID]: v.optional(
      v.object({ updates: v.array(companionUpdateSchema) }),
    ),
  }),
});

const repoSchema = v.object({ stargazers_count: v.number() });
const pluginStatsSchema = v.object({
  [gitConfig.repo]: v.optional(v.object({ downloads: v.number() })),
});

function isApiRequest(url: string) {
  return new URL(url).host === API_HOST;
}

async function fetchJson<T>(
  url: string,
  schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": `${gitConfig.user}-${gitConfig.repo}-docs`,
        ...(env.GITHUB_TOKEN &&
          isApiRequest(url) && {
            authorization: `Bearer ${env.GITHUB_TOKEN}`,
          }),
      },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
    if (!response.ok) return null;
    const parsed = v.safeParse(schema, await response.json());
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

function getReleases() {
  return fetchJson(
    `https://api.github.com/repos/${repoSlug}/releases?per_page=30`,
    releasesSchema,
  );
}

function newestRelease(releases: GhReleases, channel: ReleaseChannel) {
  return (
    releases
      .filter(
        (release) =>
          !release.draft &&
          release.prerelease === (channel === "pre-release") &&
          valid(release.tag_name),
      )
      .sort((a, b) => rcompare(a.tag_name, b.tag_name))
      .at(0) ?? null
  );
}

function isDormant(preRelease: string, stable: string | null) {
  return stable !== null && !gt(preRelease, stable);
}

async function getCompanion(channel: ReleaseChannel) {
  const manifest = await fetchJson(
    assetUrl(
      "zotero-release",
      channel === "pre-release" ? "update-beta.json" : "update.json",
    ),
    companionManifestSchema,
  );
  const update = manifest?.addons[ZOTERO_ADDON_ID]?.updates.at(-1);
  if (!update) return null;

  const { version } = update;
  const { strict_min_version, strict_max_version } = update.applications.zotero;
  return {
    version,
    tag: `zt-${version}`,
    xpiUrl: assetUrl(`zt-${version}`, `zotlit-zotero-${version}.xpi`),
    minVersion: strict_min_version,
    maxVersion: strict_max_version,
  };
}

function formatZoteroRange(min: string, max?: string): string {
  if (!max || max === "*")
    return m.docs_zotero_minimum_version({ version: min });
  if (max.endsWith(".*")) {
    const line = max.slice(0, -2);
    return min === `${line}.0`
      ? `Zotero ${line}.x`
      : `Zotero ${min} – ${line}.x`;
  }
  return min === max ? `Zotero ${min}` : `Zotero ${min} – ${max}`;
}

export interface LedgerEntry {
  version: string;
  notesUrl: string;
  publishedAt?: string;
  requires: string;
  note?: string;
}

export interface LedgerEmpty {
  empty: "not yet released" | "no pre-release available";
}

export type Ledger = LedgerEntry | LedgerEmpty | null;

export interface CompanionDownload {
  version: string;
  xpiUrl: string;
}

export interface ReleaseSnapshot {
  obsidian: Record<ReleaseChannel, Ledger>;
  zotero: Record<ReleaseChannel, Ledger>;
  companion: Record<ReleaseChannel, CompanionDownload | null>;
}

const dormant: LedgerEmpty = { empty: "no pre-release available" };

export async function getReleaseSnapshot(): Promise<ReleaseSnapshot> {
  const [releases, stableManifest, companionStable, companionPreRelease] =
    await Promise.all([
      getReleases(),
      fetchJson(
        `https://raw.githubusercontent.com/${repoSlug}/${gitConfig.branch}/manifest.json`,
        pluginManifestSchema,
      ),
      getCompanion("stable"),
      getCompanion("pre-release"),
    ]);

  const publishedAt = (tag: string) =>
    releases?.find((release) => release.tag_name === tag)?.published_at ??
    undefined;

  const obsidianStable: Ledger = stableManifest && {
    version: stableManifest.version,
    notesUrl: tagUrl(stableManifest.version),
    publishedAt: publishedAt(stableManifest.version),
    requires: `Obsidian ≥ ${stableManifest.minAppVersion}`,
    note: stableManifest.isDesktopOnly
      ? m.docs_release_desktop_only()
      : undefined,
  };

  const companionLedger = (channel: ReleaseChannel): Ledger => {
    const companion =
      channel === "pre-release" ? companionPreRelease : companionStable;
    if (channel === "pre-release") {
      if (
        !companion ||
        isDormant(companion.version, companionStable?.version ?? null)
      ) {
        return dormant;
      }
    }
    if (!companion) return { empty: "not yet released" };
    return {
      version: companion.version,
      notesUrl: tagUrl(companion.tag),
      publishedAt: publishedAt(companion.tag),
      requires: formatZoteroRange(companion.minVersion, companion.maxVersion),
    };
  };

  return {
    obsidian: {
      stable: obsidianStable,
      "pre-release": await getObsidianPreRelease(
        releases,
        stableManifest?.version ?? null,
      ),
    },
    zotero: {
      stable: companionLedger("stable"),
      "pre-release": companionLedger("pre-release"),
    },
    companion: {
      stable: companionStable,
      "pre-release": companionPreRelease,
    },
  };
}

async function getObsidianPreRelease(
  releases: GhReleases | null,
  stableVersion: string | null,
): Promise<Ledger> {
  if (!releases) return null;
  const release = newestRelease(releases, "pre-release");
  if (!release || isDormant(release.tag_name, stableVersion)) return dormant;

  const manifest = await fetchJson(
    assetUrl(release.tag_name, "manifest.json"),
    pluginManifestSchema,
  );
  if (!manifest) return null;
  return {
    version: manifest.version,
    notesUrl: tagUrl(release.tag_name),
    publishedAt: release.published_at ?? undefined,
    requires: `Obsidian ≥ ${manifest.minAppVersion}`,
    note: manifest.isDesktopOnly ? m.docs_release_desktop_only() : undefined,
  };
}

export interface RepoStats {
  stars: number | null;
  downloads: number | null;
}

export async function getRepoStats(): Promise<RepoStats> {
  const [repo, plugins] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${repoSlug}`, repoSchema),
    fetchJson(
      "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json",
      pluginStatsSchema,
    ),
  ]);

  return {
    stars: repo?.stargazers_count ?? null,
    downloads: plugins?.[gitConfig.repo]?.downloads ?? null,
  };
}

export function releaseFactHandlers(lookup: () => Promise<unknown>) {
  return {
    GET: async () =>
      Response.json(await lookup(), {
        headers: { "cache-control": `public, max-age=${CACHE_SECONDS}` },
      }),
  };
}
