import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import type { ExcerptSummary } from "#obsidian/excerpt-image/contract.ts";
import type { ExcerptOutcomeScope } from "#obsidian/excerpt-image/outcome-scope.ts";
import type { ExcerptRequest } from "#obsidian/excerpt-image/service.ts";
import { Context, Effect, Layer } from "effect";
import type { FileSystem } from "effect";
import type { TFile } from "obsidian";

import { annotationHasCacheImage, parseAnnotationPosition } from "@zotlit/db";
import type { Annotation, AnnotationResolvers, TemplateLink } from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import { markdownLinker } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import type { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import type { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { VaultError } from "@zotlit/plugin-kernel/vault-errors.ts";
import type {} from "@zotlit/plugin-services/core/attachment-import/settings.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";
import { annotationOpenUri } from "@zotlit/zotero-types/uri";

import { createExcerptLink, summarizeExcerpts } from "./helper.ts";
import {
  makePublicationGate,
  materializeExcerpt,
  retainExcerpt,
} from "./materialize.ts";
import type { MaterializedExcerpt, PublicationGate } from "./materialize.ts";

import { referencedExcerptPaths } from "#obsidian/excerpt-image/references.ts";
import { annotationRecordOf } from "#obsidian/excerpt-image/request.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";
export type { ExcerptSummary } from "#obsidian/excerpt-image/contract.ts";

const logged = withLogCategory("excerpt-prepare");

const skipLogged = (message: string, annotationKey: string) =>
  recover(
    (cause) =>
      Effect.logDebug(message).pipe(
        Effect.annotateLogs({ annotationKey, cause }),
        logged,
      ),
    Effect.void,
  );

export function collectExcerptSummary(): {
  add: (summary: ExcerptSummary) => void;
  total: () => ExcerptSummary | undefined;
} {
  const total: ExcerptSummary = { zotero: 0, unchecked: 0, unavailable: 0 };
  return {
    add(summary) {
      total.zotero += summary.zotero;
      total.unchecked += summary.unchecked;
      total.unavailable += summary.unavailable;
      if (summary.notRefreshed)
        total.notRefreshed = (total.notRefreshed ?? 0) + summary.notRefreshed;
    },
    total: () => nonEmptySummary(total),
  };
}

export const nonEmptySummary = (
  summary: ExcerptSummary,
): ExcerptSummary | undefined =>
  summary.zotero ||
  summary.unchecked ||
  summary.unavailable ||
  summary.notRefreshed
    ? summary
    : undefined;

export type ExcerptPreparationReads = Pick<
  ZoteroReadsApi,
  "AttachmentsByKeys" | "DatabaseIdentity" | "Libraries"
>;

export type ExcerptPrepareError =
  | Effect.Error<
      ReturnType<ExcerptPreparationReads[keyof ExcerptPreparationReads]>
    >
  | VaultError;

export interface PreparedExcerpts {
  annotationImageLink: AnnotationResolvers["annotationImageLink"];
  readonly prepare: Effect.Effect<void, ExcerptPrepareError>;
  summary(): ExcerptSummary;
}

export interface NoteExcerptOptions {
  reads: ExcerptPreparationReads;
  notePath: string;
  settings: Readonly<Settings>;
  previousNote?: TFile;
  outcomes?: ExcerptOutcomeScope;
}

export interface CardExcerptOptions {
  annotation: AnnotationRecord;
  request: ExcerptRequest | null;
  settings: Readonly<Settings>;
  notePath: string;
  sourceLink: string;
  valid: Effect.Effect<boolean>;
}

export interface PreparedCardExcerpt {
  helper: TemplateLink | null;
  summary(): ExcerptSummary;
}

export class ExcerptPreparation extends Context.Service<
  ExcerptPreparation,
  {
    forNote(options: NoteExcerptOptions): Effect.Effect<PreparedExcerpts>;
    forCard(options: CardExcerptOptions): Effect.Effect<PreparedCardExcerpt>;
  }
>()("zotlit/excerpt-image/ExcerptPreparation") {}

export type ExcerptPreparationServices =
  | ExcerptImageService
  | FileManager
  | FileSystem.FileSystem
  | MetadataCache
  | Vault
  | VaultDisk
  | Workspace
  | ZoteroPref;

export const layerExcerptPreparation = Layer.effect(
  ExcerptPreparation,
  Effect.gen(function* () {
    const context = yield* Effect.context<ExcerptPreparationServices>();
    const gate = yield* makePublicationGate;
    const link = yield* markdownLinker;
    const markdownLinkFrom =
      (notePath: string) => (file: TFile, subpath?: string, alias?: string) =>
        link(file, notePath, { subpath, alias });
    return ExcerptPreparation.of({
      forNote: Effect.fn("ExcerptPreparation.forNote")(function* (options) {
        const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref)
          .current;
        return noteExcerpts(
          {
            gate,
            markdownLink: markdownLinkFrom(options.notePath),
            paths: { dataDir, baseAttachmentPath },
          },
          options,
          (effect) => Effect.provideContext(effect, context),
        );
      }, Effect.provideContext(context)),
      forCard: Effect.fn("ExcerptPreparation.forCard")((options) =>
        cardExcerpt(gate, markdownLinkFrom(options.notePath), options).pipe(
          Effect.provideContext(context),
        ),
      ),
    });
  }),
);

interface Candidate {
  annotation: Annotation;
  result: MaterializedExcerpt;
  sourceLink: string;
  used: boolean;
  helper: TemplateLink;
}

function noteExcerpts(
  deps: {
    gate: PublicationGate;
    markdownLink: Parameters<typeof createExcerptLink>[0];
    paths: { dataDir: string; baseAttachmentPath: string | null };
  },
  { reads, notePath, settings, previousNote, outcomes }: NoteExcerptOptions,
  provide: <A, E>(
    effect: Effect.Effect<A, E, ExcerptPreparationServices>,
  ) => Effect.Effect<A, E>,
): PreparedExcerpts {
  const candidates = new Map<string, Candidate>();
  const prepare = Effect.gen(function* () {
    const keysByLibrary = Map.groupBy(
      candidates.values(),
      ({ annotation }) => annotation.libraryID,
    );
    const [database, libraries, attachmentLists] = yield* Effect.all(
      [
        reads.DatabaseIdentity({}),
        reads.Libraries({}),
        Effect.forEach(
          keysByLibrary,
          ([libraryID, group]) =>
            reads.AttachmentsByKeys({
              libraryID,
              keys: group.map(({ annotation }) => annotation.parentKey),
            }),
          { concurrency: "unbounded" },
        ),
      ],
      { concurrency: "unbounded" },
    );
    const attachments = new Map(
      attachmentLists.flat().map((a) => [a.itemID, a]),
    );
    const images = yield* ExcerptImageService;
    const operation = yield* images.operation({ outcomes });
    const previousPaths = previousNote
      ? yield* referencedExcerptPaths(previousNote)
      : [];
    for (const candidate of candidates.values()) {
      const a = candidate.annotation;
      yield* Effect.gen(function* () {
        const attachment = attachments.get(a.parentItemID);
        if (!attachment) return;
        const position = parseAnnotationPosition(
          a.position,
          attachment.contentType ?? "application/pdf",
        );
        const request: ExcerptRequest = {
          annotation: annotationRecordOf(a, attachment, position),
          source: {
            kind: "zotero-db",
            database,
            libraryID: a.libraryID,
            libraryRevision:
              libraries.find((l) => l.libraryID === a.libraryID)
                ?.clientVersion ?? null,
          },
          sourceScope: deps.paths.dataDir,
          libraryID: a.libraryID,
          attachmentKey: attachment.indexedKey,
          pdfPath: attachmentAbsPath(attachment, deps.paths),
          zoteroPngPath: resolveAnnotCachePath(a, {
            dataDir: deps.paths.dataDir,
            groupID: a.groupID,
          }),
        };
        yield* Effect.gen(function* () {
          if (!settings["attachment.import"]) {
            candidate.result = { kind: "unavailable", reason: "disabled" };
            return;
          }
          const outcome = yield* operation.resolve(request);
          candidate.result = yield* materializeExcerpt({
            gate: deps.gate,
            notePath,
            settings,
            request,
            outcome,
          });
        }).pipe(skipLogged("Excerpt resolution failed", a.indexedKey));
        if (candidate.result.kind === "unavailable") {
          candidate.result =
            (yield* retainExcerpt({ request, paths: previousPaths })) ??
            candidate.result;
        }
      }).pipe(skipLogged("Excerpt preparation failed", a.indexedKey));
    }
  }).pipe(Effect.scoped, provide);
  return {
    annotationImageLink(annotation) {
      if (!annotationHasCacheImage(annotation.type)) return null;
      const prior = candidates.get(annotation.indexedKey);
      if (prior) return prior.helper;
      const candidate: Candidate = {
        annotation,
        result: { kind: "unavailable", reason: "source" },
        sourceLink: `[Zotero](${annotationOpenUri({ attachmentKey: annotation.parentKey, annotationKey: annotation.key, groupID: annotation.groupID, pageLabel: annotation.pageLabel })})`,
        used: false,
        helper: () => "",
      };
      candidate.helper = createExcerptLink(deps.markdownLink, candidate);
      candidates.set(annotation.indexedKey, candidate);
      return candidate.helper;
    },
    prepare,
    summary() {
      return summarizeExcerpts(candidates.values());
    },
  };
}

const cardExcerpt = Effect.fnUntraced(function* (
  gate: PublicationGate,
  markdownLink: Parameters<typeof createExcerptLink>[0],
  options: CardExcerptOptions,
) {
  const { annotation, request, settings } = options;
  let result: MaterializedExcerpt = {
    kind: "unavailable",
    reason: settings["attachment.import"] ? "source" : "disabled",
  };
  const image = annotationHasCacheImage(annotation.type);
  if (
    image &&
    request &&
    settings["attachment.import"] &&
    (yield* options.valid)
  ) {
    const images = yield* ExcerptImageService;
    yield* Effect.gen(function* () {
      const outcome = yield* images.resolve(request);
      if (yield* options.valid)
        result = yield* materializeExcerpt({
          gate,
          notePath: options.notePath,
          settings,
          request,
          outcome,
          valid: options.valid,
        });
    }).pipe(skipLogged("Captured excerpt preparation failed", annotation.key));
  }
  const state = { used: false, result, sourceLink: options.sourceLink };
  const prepared: PreparedCardExcerpt = {
    helper: image ? createExcerptLink(markdownLink, state) : null,
    summary() {
      return summarizeExcerpts([state]);
    },
  };
  return prepared;
});
