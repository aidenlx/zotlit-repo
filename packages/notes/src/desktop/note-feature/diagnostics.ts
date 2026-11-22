import type { ManagedFrontmatterPreparationFailure } from "#core/note-feature/frontmatter.ts";
import type { ComposeWarn } from "#obsidian/note-feature/compose.ts";
import { Effect } from "effect";
import type { TFile } from "obsidian";

import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  ProfileId,
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type {
  CreateNoteResult,
  LiteratureNoteTemplateConversionRequiredDiagnostic,
  ManagedFrontmatterFailureDiagnostic,
  ManagedFrontmatterRefusalDiagnostic,
  MissingLiteratureNoteTemplateDiagnostic,
  UpdateResult,
} from "./types.ts";

const logged = withLogCategory("note-feature");

export const composeWarn: Effect.Effect<ComposeWarn> = Effect.gen(function* () {
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  return (message, annotations) =>
    run(
      Effect.logWarning(message).pipe(Effect.annotateLogs(annotations), logged),
    );
});

const NO_BODY_UPDATE: UpdateResult = {
  bodyUpdated: false,
  duplicateRegionCount: 0,
};

function refusedCreate(
  indexedKey: string,
  existing: readonly TFile[],
): Extract<CreateNoteResult, { outcome: "refused" }> {
  const paths = existing.map((file) => file.path) as [string, ...string[]];
  return {
    outcome: "refused",
    diagnostic: {
      code:
        existing.length === 1
          ? "literature-note-exists"
          : "duplicate-literature-notes",
      hint:
        existing.length === 1
          ? "Open the existing Literature Note instead of creating another."
          : "Resolve the duplicate Literature Notes, then run create again.",
      indexedKey,
      paths,
    },
  };
}

const frontmatterRefusal = Effect.fnUntraced(function* (
  failures: readonly ManagedFrontmatterPreparationFailure[],
  input: {
    itemKey: string;
    diagnosticContext: { path?: string; indexedKey?: string };
  },
) {
  for (const { key, reason, error } of failures)
    if (reason === "evaluation")
      yield* Effect.logWarning("Managed Frontmatter field failed").pipe(
        Effect.annotateLogs({ key, itemKey: input.itemKey, error }),
        logged,
      );
  const mapped = failures.map(({ key: field, reason }) => {
    if (reason === "evaluation") {
      return {
        field,
        message: m.managed_frontmatter_eval_failure({ field }),
        hint: m.managed_frontmatter_eval_recovery({ field }),
      };
    }
    return {
      field,
      message: m.managed_frontmatter_inert_failure({ field }),
      hint: m.managed_frontmatter_inert_recovery({ field }),
    };
  }) as [
    ManagedFrontmatterFailureDiagnostic,
    ...ManagedFrontmatterFailureDiagnostic[],
  ];
  const diagnostic: ManagedFrontmatterRefusalDiagnostic = {
    code: "managed-frontmatter-refused",
    hint: m.managed_frontmatter_refused_recovery(),
    failures: mapped,
    ...input.diagnosticContext,
  };
  return diagnostic;
});

function refusedUnknownProfile(
  stamp: string,
  context: { path?: string; indexedKey?: string },
): {
  outcome: "refused";
  diagnostic: UnknownProfileDiagnostic;
} {
  return {
    outcome: "refused",
    diagnostic: unknownProfileDiagnostic(stamp, context),
  };
}

function refusedUpdateProfile(stamp: string, path: string): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedUnknownProfile(stamp, { path }).diagnostic,
  };
}

function refusedMissingDocument(
  document: string,
  context: { path?: string; indexedKey?: string },
): { outcome: "refused"; diagnostic: MissingLiteratureNoteTemplateDiagnostic } {
  return {
    outcome: "refused",
    diagnostic: {
      code: "missing-literature-note-template",
      hint: `Restore '${document}' in the template folder or clear the Profile document reference.`,
      document,
      ...context,
    },
  };
}

function refusedUpdateMissingDocument(
  document: string,
  path: string,
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedMissingDocument(document, { path }).diagnostic,
  };
}

function refusedTemplateConversion(
  profileId: ProfileId,
  context: { path?: string; indexedKey?: string },
): {
  outcome: "refused";
  diagnostic: LiteratureNoteTemplateConversionRequiredDiagnostic;
} {
  return {
    outcome: "refused",
    diagnostic: {
      code: "literature-note-template-conversion-required",
      hint: "Convert the legacy Literature Note Templates before using added Profiles.",
      profileId,
      ...context,
    },
  };
}

function refusedUpdateTemplateConversion(
  profileId: ProfileId,
  path: string,
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedTemplateConversion(profileId, { path }).diagnostic,
  };
}

function refusedUpdateProfileConflict(
  indexedKey: string,
  path: string,
  profiles: {
    existingProfile: ProfileSelector;
    requestedProfile: ProfileSelector;
  },
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: {
      code: "literature-note-profile-conflict",
      hint: "Follow the stamped Profile, or switch the note interactively before this headless update.",
      indexedKey,
      path,
      existingProfile: profiles.existingProfile,
      requestedProfile: profiles.requestedProfile,
    },
  };
}

function refusedProfileConflict(
  indexedKey: string,
  file: TFile,
  profiles: {
    existingProfile: ProfileSelector;
    requestedProfile: ProfileSelector;
  },
): Extract<CreateNoteResult, { outcome: "refused" }> {
  return {
    outcome: "refused",
    diagnostic: {
      code: "literature-note-profile-conflict",
      hint: "Keep the existing Profile, or switch the note to the requested Profile and refresh its managed content.",
      indexedKey,
      path: file.path,
      existingProfile: profiles.existingProfile,
      requestedProfile: profiles.requestedProfile,
    },
  };
}

export {
  frontmatterRefusal,
  NO_BODY_UPDATE,
  refusedCreate,
  refusedMissingDocument,
  refusedProfileConflict,
  refusedTemplateConversion,
  refusedUnknownProfile,
  refusedUpdateMissingDocument,
  refusedUpdateProfile,
  refusedUpdateProfileConflict,
  refusedUpdateTemplateConversion,
};
