import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { assetUrl, tagUrl } from "./github-releases.ts";
import { getReleaseSnapshot, releaseFactHandlers } from "./release-data.ts";
import { gitConfig, repoSlug } from "./shared.ts";

vi.mock("cloudflare:workers", () => ({ env: {} }));

beforeEach(() => {
  const stableManifest = `https://raw.githubusercontent.com/${repoSlug}/${gitConfig.branch}/manifest.json`;
  const companionManifest = assetUrl("zotero-release", "update.json");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === stableManifest)
        return Response.json({ version: "2.0.0", minAppVersion: "1.13.0" });
      if (url === companionManifest) return Response.json({});
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const expected = {
  obsidian: {
    stable: {
      version: "2.0.0",
      notesUrl: tagUrl("2.0.0"),
      requires: "Obsidian ≥ 1.13.0",
    },
    "pre-release": null,
  },
  zotero: {
    stable: { empty: "not yet released" },
    "pre-release": { empty: "no pre-release available" },
  },
  companion: { stable: null, "pre-release": null },
};

it("preserves the Obsidian ledger when the Companion manifest is malformed", async () => {
  await expect(getReleaseSnapshot()).resolves.toEqual(expected);
});

it("serves the available install facts as JSON when the Companion manifest is malformed", async () => {
  const response = await releaseFactHandlers(getReleaseSnapshot).GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected);
});
