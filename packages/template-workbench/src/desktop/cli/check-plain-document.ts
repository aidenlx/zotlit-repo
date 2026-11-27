import type { RenderCallerSource } from "#core/render/index.ts";
import type { ProfileCheck } from "#obsidian/cli/check-profile.ts";
import { Effect, Schema } from "effect";

import type { CitationTemplateData } from "@zotlit/db";
import { serializeTemplateData } from "@zotlit/db/template-data";
import { plainTemplateError } from "@zotlit/notes/core/template/errors.ts";
import {
  readCitationData,
  readTemplateData,
  withSettings,
} from "@zotlit/notes/desktop/template/data.ts";
import {
  Profile,
  ProfileOperationError,
} from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { templateCall } from "@zotlit/notes/obsidian/template/sync-template.ts";
import { parseProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { parsePlainTemplateDocument } from "@zotlit/templates/facade";

import type {
  CheckContext,
  CheckOutcome,
  CheckServices,
  InspectedSource,
  PlainCheckBranch,
} from "./check.ts";
import type { InspectDiagnosticCode } from "./inspect-contract.ts";
import { INSPECT_DIAGNOSTICS } from "./inspect-contract.ts";
import { createInspectHandler, sourceRevision } from "./inspect.ts";

import { isCitationExampleId } from "#core/render/index.ts";
import { checkDiagnostic } from "#obsidian/cli/check-profile.ts";

export const RESERVED_PARTIAL_NAME =
  "RESERVED_PARTIAL_NAME" satisfies InspectDiagnosticCode;

export class CheckSourceThrew extends Schema.TaggedError<
  CheckSourceThrew,
  { readonly brand: unique symbol }
>()("CheckSourceThrew", { cause: Schema.Defect() }) {}

export const attempt = <A>(evaluate: () => A) =>
  Effect.try({
    try: evaluate,
    catch: (cause) => new CheckSourceThrew({ cause }),
  });

export const thrown = (error: unknown): unknown =>
  error instanceof CheckSourceThrew || error instanceof ProfileOperationError
    ? error.cause
    : plainTemplateError(error);

export const checkPlainDocument = Effect.fn(
  "TemplateWorkbenchCli.checkPlainDocument",
)(function* ({
  params,
  draft,
  inspect,
  inspectRequest,
  inspected,
  source,
  root,
  context,
  attachReport,
}: PlainCheckBranch): Effect.fn.Return<CheckOutcome, never, CheckServices> {
  const document = inspected.document!;
  let documentContext: CheckContext = context;
  if (
    document.problems.some((problem) => problem.code === RESERVED_PARTIAL_NAME)
  )
    return {
      context: documentContext,
      result: {
        ok: false,
        diagnostic: {
          code: RESERVED_PARTIAL_NAME,
          ...INSPECT_DIAGNOSTICS.RESERVED_PARTIAL_NAME,
        },
      },
    };
  const checks: Record<string, ProfileCheck> = {
    structure: { status: "not-checked", diagnostics: [] },
    [document.kind]: { status: "not-checked", diagnostics: [] },
  };
  let caller: RenderCallerSource = { source, language: "liquid" };
  return yield* Effect.gen(function* (): Effect.fn.Return<
    CheckOutcome,
    unknown,
    CheckServices
  > {
    const parsed = yield* attempt(() => parsePlainTemplateDocument(source));
    documentContext = {
      ...documentContext,
      language: parsed.manifest.language,
    };
    caller = { source, language: parsed.manifest.language };
    const template = yield* Template;
    if (
      documentContext.language === "eta" &&
      !(yield* template.javascriptTemplatesEnabled)
    )
      return {
        context: documentContext,
        result: {
          ok: false,
          checks,
          rendering: "not-checked",
          diagnostic: {
            ...attachReport(documentContext, {
              code: "render-error",
              part: "render",
              message: "JavaScript Templates are disabled on this device.",
              hint: "Enable JavaScript Templates on this device or use a Liquid document.",
            }),
            code: "ETA_OPT_IN_REQUIRED",
            message: "JavaScript Templates are disabled on this device.",
            evidence: {
              kind: "javascript-gate",
              enabled: false,
              source: inspected.input,
              language: documentContext.language,
            },
          },
        },
      };
    const inspectBindings = createInspectHandler(
      undefined,
      draft ? document.id : undefined,
    );
    const profileInspection = JSON.parse(
      yield* inspectBindings({
        profile: params.profile ?? "default",
        source: "full",
      }),
    ) as InspectedSource;
    if (!profileInspection.ok)
      return {
        context: documentContext,
        result: {
          ok: false,
          checks,
          diagnostic: profileInspection.diagnostic,
          bindingContext: {
            document: profileInspection.document,
            input: profileInspection.input,
            freshness: profileInspection.freshness,
          },
        },
      };
    const profileId =
      profileInspection.document?.profile?.id ??
      profileInspection.document?.profileIdentity?.id ??
      "default";
    const selector = parseProfileSelector(profileId);
    const profile =
      selector === undefined
        ? undefined
        : yield* (yield* Profile).resolveProfile(selector);
    if (!profile)
      return yield* new CheckSourceThrew({
        cause: new Error("The selected Profile does not resolve."),
      });
    documentContext = {
      ...documentContext,
      answer: {
        ...documentContext.answer,
        selectedProfile: {
          id: profile.selector,
          bindings: profile.bindings,
        },
        bindingContext: {
          input: profileInspection.input,
          freshness: profileInspection.freshness,
        },
      },
      profileSelector: profile.selector,
    };
    checks.structure = { status: "passed", diagnostics: [] };
    if (params.key === undefined && params.example === undefined)
      return {
        context: documentContext,
        result: {
          ok: true,
          checks,
          rendering: "not-checked",
          reason: "Provide key or a Citation example to check rendering.",
        },
      };
    const loaded = yield* (
      root === "citation"
        ? readCitationData(
            typeof params.example === "string" &&
              isCitationExampleId(params.example)
              ? { example: params.example }
              : { key: params.key as string },
            params.variant ?? "main",
          )
        : readTemplateData(
            params.key as string,
            root as "note" | "annotation",
          ).pipe(withSettings(profile.settings))
    ).pipe(Effect.mapError(({ cause }) => cause));
    if (loaded.kind !== "data")
      return {
        context: documentContext,
        result: {
          ok: false,
          checks,
          diagnostic: {
            code: "INVALID_SELECTOR",
            message: `The selected data is unavailable: ${loaded.kind}.`,
            hint:
              root === "annotation"
                ? "Select an existing annotation key with a readable parent attachment."
                : "Select an existing item key, or use a built-in example for the Citation root.",
          },
        },
      };
    const { citation: _citation, ...annotationDescriptors } =
      Object.getOwnPropertyDescriptors(loaded.data);
    const dataRevision = yield* attempt(() =>
      sourceRevision(
        JSON.stringify(
          serializeTemplateData(
            root === "annotation"
              ? Object.defineProperties({}, annotationDescriptors)
              : loaded.data,
            root as "note" | "annotation" | "citation",
          ),
        ),
      ),
    );
    documentContext = { ...documentContext, dataRevision };
    checks[document.kind] = yield* templateCall(
      document.kind === "citation"
        ? template.renderCitationSource(
            source,
            loaded.data as CitationTemplateData,
          )
        : template.renderPartialSource(source, loaded.data, {
            name: document.label,
          }),
    ).pipe(
      Effect.match({
        onSuccess: (rendered): ProfileCheck => ({
          status: "passed",
          diagnostics: [],
          output: rendered,
        }),
        onFailure: (error): ProfileCheck => ({
          status: "failed",
          diagnostics: [checkDiagnostic(error, caller)],
        }),
      }),
    );
    const after = JSON.parse(yield* inspect(inspectRequest)) as InspectedSource;
    const profileAfter = JSON.parse(
      yield* inspectBindings({
        profile: params.profile ?? "default",
        source: "full",
      }),
    ) as InspectedSource;
    if (
      !after.ok ||
      after.input?.revision !== inspected.input?.revision ||
      JSON.stringify(after.freshness?.versions) !==
        JSON.stringify(inspected.freshness?.versions) ||
      !profileAfter.ok ||
      profileAfter.input?.revision !== profileInspection.input?.revision ||
      JSON.stringify(profileAfter.freshness?.versions) !==
        JSON.stringify(profileInspection.freshness?.versions)
    )
      return {
        context: documentContext,
        result: {
          ok: false,
          rendering: "checked",
          freshness: {
            ...inspected.freshness,
            state: "superseded",
            after: after.freshness,
          },
          bindingContext: {
            before: documentContext.answer.bindingContext,
            after: {
              input: profileAfter.input,
              freshness: profileAfter.freshness,
              diagnostic: profileAfter.diagnostic,
            },
          },
          diagnostic: {
            code: "SOURCE_SUPERSEDED",
            message: "Source changed during this attempt.",
            hint: "Run a new check to read the current source.",
          },
        },
      };
    return {
      context: documentContext,
      result: {
        checks,
        ok: Object.values(checks).every((check) => check.status === "passed"),
        rendering: "checked",
      },
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.sync((): CheckOutcome => {
        const diagnostic = checkDiagnostic(thrown(error), caller);
        checks.structure = { status: "failed", diagnostics: [diagnostic] };
        return {
          context: documentContext,
          result: {
            ok: false,
            checks,
            diagnostic: attachReport(documentContext, diagnostic),
          },
        };
      }),
    ),
  );
});
