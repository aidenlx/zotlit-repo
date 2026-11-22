import { basename } from "node:path";
import { valid } from "semver";
import * as v from "valibot";

export const ZoteroManifestSchema = v.object({
  manifest_version: v.literal(2),
  name: v.string(),
  version: v.pipe(
    v.string(),
    v.check((s) => valid(s) !== null, "must be a valid semver version"),
  ),
  description: v.optional(v.string()),
  author: v.optional(v.string()),
  homepage_url: v.optional(v.string()),
  icons: v.record(v.string(), v.string()),
  applications: v.object({
    zotero: v.object({
      id: v.string(),
      strict_min_version: v.string(),
      strict_max_version: v.optional(v.string()),
      update_url: v.string(),
    }),
  }),
});

export type ZoteroManifest = v.InferOutput<typeof ZoteroManifestSchema>;

const IconSourceSchema = v.pipe(
  v.string("`zotero.icon` must be a package-relative path to the icon file"),
  v.nonEmpty(),
);

export function iconEntryPath(iconSource: string): string {
  return `icons/${basename(iconSource)}`;
}

export function parseManifest(data: any, updateUrl: string): ZoteroManifest {
  const {
    version,
    description,
    author,
    homepage,
    zotero: { id, strict_min_version, strict_max_version, icon } = {},
  } = data;

  const iconEntry = iconEntryPath(v.parse(IconSourceSchema, icon));

  return v.parse(ZoteroManifestSchema, {
    manifest_version: 2,
    name: "ZotLit",
    version,
    description,
    author,
    homepage_url: homepage,
    icons: {
      32: iconEntry,
      48: iconEntry,
      64: iconEntry,
      96: iconEntry,
    },
    applications: {
      zotero: {
        id,
        strict_min_version,
        strict_max_version,
        update_url: updateUrl,
      },
    },
  });
}
