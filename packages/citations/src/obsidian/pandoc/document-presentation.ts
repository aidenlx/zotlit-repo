import type { Citation } from "#obsidian/citation-index/query.ts";
import { Cause, Effect, Exit } from "effect";
import type { MetadataCache, TFile } from "obsidian";

import type { CslItemData } from "@zotlit/db";
import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import {
  FIELD_CITATION_STYLE,
  FIELD_DOCUMENT_LANGUAGE,
  FIELD_ZOTERO_NOTE_KEY,
} from "@zotlit/plugin-kernel/constants.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { isLanguageTag } from "@zotlit/plugin-kernel/language-tag.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import type { ProfileStyleReader, ProfileStyles } from "./profile-styles.ts";
import type { RenderPresentation } from "./render-cache.ts";

export type UnusableProperty = "style" | "language";

export interface ProfilePresentationFailure {
  kind: "unusable";
  property: "profile";
  diagnostic: UnknownProfileDiagnostic;
  target: string;
}

export interface ProfileStyleSource {
  profile: ProfileSelector;
  label?: string;
  target: string;
}

export interface ProfileStylePresentationFailure extends ProfileStyleSource {
  kind: "unusable";
  property: "profile-style";
  styleId: string;
}

export type DocumentPresentationFailure =
  | { kind: "unusable"; property: UnusableProperty }
  | ProfilePresentationFailure
  | ProfileStylePresentationFailure;

export type StyleSource =
  | { kind: "note" }
  | { kind: "profile"; label: string | undefined }
  | { kind: "vault" };

export function styleSourceOf({
  presentation,
  profileStyle,
}: {
  presentation: RenderPresentation;
  profileStyle?: ProfileStyleSource;
}): StyleSource {
  if (profileStyle) return { kind: "profile", label: profileStyle.label };
  return presentation.styleId === undefined
    ? { kind: "vault" }
    : { kind: "note" };
}

export type DocumentPresentation =
  | {
      kind: "read";
      presentation: RenderPresentation;
      profileStyle?: ProfileStyleSource;
    }
  | DocumentPresentationFailure;

export function profileReaderOf(
  profile: Pick<ProfileStyles["Service"], "loaded" | "profileOf">,
  run: <A, E>(effect: Effect.Effect<A, E>) => A,
): ProfileStyleReader {
  const read = <A>(effect: Effect.Effect<A, unknown>): A => {
    const exit = run(Effect.exit(effect));
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  };
  return {
    get loaded() {
      return read(profile.loaded);
    },
    profileOf: (file) => read(profile.profileOf(file)),
  };
}

export function documentPresentation(
  metadataCache: Pick<MetadataCache, "getFileCache">,
  file: TFile,
  profiles?: ProfileStyleReader,
): DocumentPresentation {
  const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
  const presentation: RenderPresentation = {};
  let profileStyle: ProfileStyleSource | undefined;

  const declaredStyle = frontmatter?.[FIELD_CITATION_STYLE] as unknown;
  if (profiles && frontmatter?.[FIELD_ZOTERO_NOTE_KEY] !== undefined) {
    if (!profiles.loaded)
      return {
        kind: "unusable",
        property: "profile",
        diagnostic: unknownProfileDiagnostic(
          String(frontmatter["zotlit-profile"] ?? "default"),
        ),
        target: file.path,
      };
    const resolved = profiles.profileOf(file);
    if (!resolved.ok) {
      Effect.runSyncWith(logServices)(
        Effect.logDebug("The Imported Note Profile is unavailable").pipe(
          Effect.annotateLogs({
            path: file.path,
            stamp: resolved.stamped.stamp,
          }),
          withLogCategory("pandoc", "document-presentation"),
        ),
      );
      return {
        kind: "unusable",
        property: "profile",
        diagnostic: unknownProfileDiagnostic(resolved.stamped.stamp),
        target: file.path,
      };
    }
    presentation.styleId =
      resolved.profile.bindings["citation.references-style"];
    profileStyle = {
      profile: resolved.profile.selector,
      label: resolved.profile.label,
      target: file.path,
    };
  } else if (declaredStyle !== undefined) {
    const styleId =
      typeof declaredStyle === "string" ? declaredStyle.trim() : "";
    if (!styleId) {
      Effect.runSyncWith(logServices)(
        Effect.logDebug(
          "The document citation style property is no style ID",
        ).pipe(
          Effect.annotateLogs({
            path: file.path,
            property: FIELD_CITATION_STYLE,
          }),
          withLogCategory("pandoc", "document-presentation"),
        ),
      );
      return { kind: "unusable", property: "style" };
    }
    presentation.styleId = styleId;
  }

  const declaredLanguage = frontmatter?.[FIELD_DOCUMENT_LANGUAGE] as unknown;
  if (declaredLanguage !== undefined) {
    const locale =
      typeof declaredLanguage === "string" ? declaredLanguage.trim() : "";
    if (!isLanguageTag(locale)) {
      Effect.runSyncWith(logServices)(
        Effect.logDebug(
          "The document language property is no language tag",
        ).pipe(
          Effect.annotateLogs({
            path: file.path,
            property: FIELD_DOCUMENT_LANGUAGE,
          }),
          withLogCategory("pandoc", "document-presentation"),
        ),
      );
      return { kind: "unusable", property: "language" };
    }
    presentation.locale = locale;
  }

  return {
    kind: "read",
    presentation,
    ...(profileStyle ? { profileStyle } : {}),
  };
}

export interface EffectivePresentation {
  styleId: string | null;
  locale: string | null;
}

export function vaultPresentation(
  settings: Readonly<Settings> | null | undefined,
  profiles: Pick<ProfileStyles["Service"], "vaultStyleId">,
): EffectivePresentation {
  return {
    styleId: settings ? profiles.vaultStyleId(settings) : null,
    locale: settings?.["citation.locale"] || null,
  };
}

export function effectivePresentation(
  declared: RenderPresentation,
  vault: EffectivePresentation,
): EffectivePresentation {
  const { styleId, locale } = declared;
  return {
    styleId: styleId === undefined ? vault.styleId : styleId,
    locale: locale === undefined ? vault.locale : locale,
  };
}

interface CitedWork {
  readonly csl: CslItemData;
}

export type DocumentCitationPresentation =
  | DocumentPresentationFailure
  | {
      kind: "read";
      presentation: EffectivePresentation;
      items: readonly CslItemData[];
    };

export function documentCitationPresentation(
  declared: DocumentPresentation,
  vault: EffectivePresentation,
  cited: {
    citations: readonly Pick<Citation, "indexedKey">[];
    works: ReadonlyMap<string, CitedWork>;
  },
): DocumentCitationPresentation {
  if (declared.kind === "unusable") return declared;
  const items: CslItemData[] = [];
  for (const { indexedKey } of cited.citations) {
    const work = indexedKey === null ? undefined : cited.works.get(indexedKey);
    if (work) items.push(work.csl);
  }
  return {
    kind: "read",
    presentation: effectivePresentation(declared.presentation, vault),
    items,
  };
}

export function samePresentation(
  left: DocumentPresentation,
  right: DocumentPresentation,
): boolean {
  if (left.kind === "unusable" || right.kind === "unusable") {
    if (
      left.kind !== "unusable" ||
      right.kind !== "unusable" ||
      left.property !== right.property
    ) {
      return false;
    }
    return left.property === "profile" && right.property === "profile"
      ? left.diagnostic.stamp === right.diagnostic.stamp &&
          left.target === right.target
      : true;
  }
  return (
    left.presentation.styleId === right.presentation.styleId &&
    left.presentation.locale === right.presentation.locale &&
    left.profileStyle?.profile === right.profileStyle?.profile &&
    left.profileStyle?.target === right.profileStyle?.target
  );
}
