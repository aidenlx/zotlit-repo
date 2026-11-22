import type { RenderCallerSource } from "#core/render/index.ts";
import type { ProfileCheck } from "#obsidian/cli/check-profile.ts";
import { Effect } from "effect";

import type { NoteTemplateContext } from "@zotlit/db";
import { serializeTemplateData } from "@zotlit/db/template-data";
import {
  readTemplateData,
  withSelectedNote,
  withSettings,
} from "@zotlit/notes/desktop/template/data.ts";
import {
  bindDraftProfile,
  Profile,
} from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import {
  profileCall,
  syncTemplate,
  templateCall,
} from "@zotlit/notes/obsidian/template/sync-template.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import {
  parseProfileSelector,
  PROFILE_ID_LENGTH,
  PROFILE_ID_RULE,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";

import { attempt, CheckSourceThrew, thrown } from "./check-plain-document.ts";
import type {
  CheckOutcome,
  CheckServices,
  InspectedSource,
  ProfileCheckBranch,
} from "./check.ts";
import { sourceRevision } from "./inspect.ts";

import {
  checkDiagnostic,
  checkComposedProfile,
  PROFILE_OUTPUTS,
} from "#obsidian/cli/check-profile.ts";

export const INVALID_PROFILE_ID = "INVALID_PROFILE_ID";

export const PROFILE_ID_MISMATCH = "PROFILE_ID_MISMATCH";

const loadRoot = (key: string, root: "note" | "filename" | "annotation") =>
  readTemplateData(key, root).pipe(Effect.mapError(({ cause }) => cause));

const threw = (cause: unknown) => new CheckSourceThrew({ cause });

export const checkProfileDocument = Effect.fn(
  "TemplateWorkbenchCli.checkProfileDocument",
)(function* ({
  params,
  draft,
  inspect,
  inspectRequest,
  inspected,
  inspectedDocument,
  source,
  context,
  attachReport,
}: ProfileCheckBranch): Effect.fn.Return<CheckOutcome, never, CheckServices> {
  let profileContext = context;
  const checks: Record<string, ProfileCheck> = Object.fromEntries(
    ["structure", ...PROFILE_OUTPUTS].map((name) => [
      name,
      { status: "not-checked", diagnostics: [] },
    ]),
  );
  let caller: RenderCallerSource = { source, language: "liquid" };
  return yield* Effect.gen(function* (): Effect.fn.Return<
    CheckOutcome,
    unknown,
    CheckServices
  > {
    const parsed = yield* attempt(() => parseLiteratureNoteTemplate(source));
    if (
      draft &&
      params.profile !== undefined &&
      parsed.manifest.id !==
        (inspectedDocument.profile?.id ?? inspectedDocument.profileIdentity?.id)
    )
      return {
        context: profileContext,
        result: {
          ok: false,
          checks: {
            ...checks,
            structure: { status: "failed", diagnostics: [] },
          },
          diagnostic: {
            code: PROFILE_ID_MISMATCH,
            message:
              "The draft manifest ID does not match the selected Profile.",
            hint: "Keep the selected Profile ID in the draft, or omit profile to check a standalone identity.",
          },
        },
      };
    profileContext = {
      ...profileContext,
      language: parsed.manifest.language ?? "liquid",
    };
    caller = {
      source,
      language: parsed.manifest.language ?? "liquid",
      profileId: parsed.manifest.id,
    };
    const template = yield* Template;
    if (
      !(yield* template.javascriptTemplatesEnabled) &&
      (parsed.manifest.language === "eta" ||
        parsed.manifest.frontmatter?.some((entry) => "js" in entry))
    ) {
      const entries =
        parsed.manifest.frontmatter?.flatMap((entry, index) =>
          "js" in entry
            ? [
                {
                  position: index + 1,
                  ...("key" in entry ? { key: entry.key } : {}),
                  expression: entry.js,
                },
              ]
            : [],
        ) ?? [];
      if (entries.length)
        checks.properties = {
          status: "failed",
          entries: entries.map(({ position, key }) => ({
            position,
            key,
            status: "failed",
          })),
          diagnostics: entries.map(({ position, key }) => ({
            code: "property-javascript",
            part: "properties",
            position,
            ...(key ? { key } : {}),
            message: "JavaScript Templates are disabled on this device.",
            hint: "Enable JavaScript Templates or replace this entry with a JSON-e value.",
          })),
        };
      return {
        context: profileContext,
        result: {
          ok: false,
          checks,
          diagnostic: {
            code: "ETA_OPT_IN_REQUIRED",
            message: "JavaScript Templates are disabled on this device.",
            hint: "Ask the user to enable JavaScript Templates in ZotLit settings, or use Liquid and JSON-e entries.",
            evidence: {
              kind: "javascript-gate",
              enabled: false,
              source: inspected.input,
              language: parsed.manifest.language ?? "liquid",
              entries,
            },
          },
          rendering: "not-checked",
        },
      };
    }
    const document = yield* templateCall(
      template.prepareLiteratureNoteTemplateSource(source),
    ).pipe(Effect.mapError((cause) => threw(cause)));
    const selector = parseProfileSelector(document.manifest.id ?? "default");
    if (draft && selector === undefined)
      return {
        context: profileContext,
        result: {
          ok: false,
          checks: {
            ...checks,
            structure: { status: "failed", diagnostics: [] },
          },
          diagnostic: {
            code: INVALID_PROFILE_ID,
            message: PROFILE_ID_RULE,
            hint: `Set the draft manifest id to 'default' or to a Profile ID of ${PROFILE_ID_LENGTH} letters or digits, then check the draft again.`,
          },
        },
      };
    const settings = draft
      ? yield* PluginSettings.use((service) => service.current)
      : undefined;
    const profile =
      selector === undefined
        ? undefined
        : settings
          ? yield* attempt(() =>
              bindDraftProfile(settings, selector, document.manifest),
            )
          : yield* profileCall((yield* Profile).resolveProfile(selector)).pipe(
              Effect.mapError((cause) => threw(cause)),
            );
    if (!profile)
      return yield* new CheckSourceThrew({
        cause: new Error("The saved Profile does not resolve."),
      });
    if (draft)
      profileContext = {
        ...profileContext,
        answer: {
          ...profileContext.answer,
          document: {
            kind: "profile",
            id: profile.selector,
            label: profile.label ?? "Default",
            path: draft.path,
            profile: {
              id: profile.selector,
              label: profile.label ?? "Default",
              bindings: profile.bindings,
            },
            problems: [],
          },
        },
      };
    checks.structure = { status: "passed", diagnostics: [] };
    if (params.key === undefined)
      return {
        context: profileContext,
        result: {
          ok: true,
          checks,
          rendering: "not-checked",
          reason:
            "Structural validation only; provide key to check rendering with real item data.",
        },
      };
    profileContext = {
      ...profileContext,
      selectedProfile: {
        id: profile.selector,
        label: profile.label ?? "Default",
      },
    };
    const baseline = profileContext.baseline;
    const selectedNote = baseline?.path
      ? withSelectedNote({ key: profileContext.itemKey, path: baseline.path })
      : <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
    const load = (key: string, root: "note" | "filename" | "annotation") =>
      loadRoot(key, root).pipe(withSettings(profile.settings), selectedNote);
    const [note, filename] = yield* Effect.all(
      [load(params.key, "note"), load(params.key, "filename")],
      { concurrency: "unbounded" },
    );
    if (note.kind !== "data" || filename.kind !== "data")
      return yield* new CheckSourceThrew({
        cause: new Error("The selected Zotero item is unavailable."),
      });
    const dataRevision = yield* attempt(() =>
      sourceRevision(
        JSON.stringify({
          note: serializeTemplateData(note.data, "note"),
          filename: serializeTemplateData(filename.data, "filename"),
        }),
      ),
    );
    profileContext = { ...profileContext, dataRevision };
    const annotations = yield* Effect.forEach(
      (note.data as NoteTemplateContext).annotations,
      (annotation) => {
        const key = annotation.indexedKey;
        return Effect.gen(function* () {
          const loaded = yield* load(key, "annotation");
          if (loaded.kind !== "data")
            return {
              key,
              error: new Error("The selected annotation is unavailable."),
            };
          const { citation: _citation, ...descriptors } =
            Object.getOwnPropertyDescriptors(loaded.data);
          const revision = yield* attempt(() =>
            sourceRevision(
              JSON.stringify(
                serializeTemplateData(
                  Object.defineProperties({}, descriptors),
                  "annotation",
                ),
              ),
            ),
          );
          return { key, data: loaded.data, revision };
        }).pipe(Effect.catch((error) => Effect.succeed({ key, error })));
      },
      { concurrency: "unbounded" },
    );
    const templates = yield* syncTemplate;
    Object.assign(
      checks,
      yield* attempt(() =>
        checkComposedProfile(templates, {
          document,
          profile,
          source,
          note: note.data as NoteTemplateContext,
          filename: filename.data,
          annotations,
          ...(baseline ? { existing: baseline.source } : {}),
        }),
      ),
    );
    const after = JSON.parse(yield* inspect(inspectRequest)) as InspectedSource;
    if (baseline?.kind === "real") {
      const vault = yield* Vault;
      const file = yield* vault.getFileByPath(baseline.path!);
      const current = file
        ? yield* vault
            .read(file)
            .pipe(Effect.mapError(({ cause }) => threw(cause)))
        : undefined;
      if (current !== baseline.source)
        return {
          context: profileContext,
          result: {
            ok: false,
            rendering: "checked",
            diagnostic: {
              code: "BASELINE_SUPERSEDED",
              message: "The Literature Note changed during this attempt.",
              hint: "Run a new check to read the current Literature Note.",
            },
          },
        };
    }
    if (
      !after.ok ||
      sourceRevision(after.source ?? "") !== inspected.input?.revision ||
      JSON.stringify(after.freshness?.versions) !==
        JSON.stringify(inspected.freshness?.versions)
    )
      return {
        context: profileContext,
        result: {
          ok: false,
          diagnostic: {
            code: "SOURCE_SUPERSEDED",
            message: "Source changed during this attempt.",
            hint: "Run a new check to read the current source.",
          },
          freshness: {
            ...inspected.freshness,
            state: "superseded",
            after: after.freshness,
          },
          rendering: "checked",
        },
      };
    return {
      context: profileContext,
      result: {
        ok: Object.values(checks).every((check) => check.status === "passed"),
        checks,
        rendering: "checked",
      },
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.sync((): CheckOutcome => {
        const diagnostic = attachReport(
          profileContext,
          checkDiagnostic(thrown(error), caller),
        );
        if (checks.structure?.status !== "passed")
          checks.structure = { status: "failed", diagnostics: [diagnostic] };
        return {
          context: profileContext,
          result: { ok: false, checks, diagnostic },
        };
      }),
    ),
  );
});
