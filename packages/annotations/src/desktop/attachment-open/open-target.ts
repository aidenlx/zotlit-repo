import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import type { ReaderOpenFailed } from "#obsidian/pdf-reader/service.ts";
import { Context, Effect, Layer, Schema } from "effect";
import type { Duration } from "effect";
import { fileURLToPath } from "node:url";
import type { PaneType } from "obsidian";

import { formatAnnotationSubpath } from "@zotlit/db";
import { Notifier, withOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { formatIndexedKey, parseIndexedKey } from "@zotlit/zotero-types/keys";
import {
  annotationOpenUri,
  attachmentOpenUri,
  parseAnnotationOpenUri,
} from "@zotlit/zotero-types/uri";

import { filename, obsidianOpenPath } from "#core/attachment-open/resolve.ts";

export type OpenTarget =
  | { readonly kind: "attachment"; readonly attachmentKey: string }
  | {
      readonly kind: "annotation";
      readonly attachmentKey: string;
      readonly annotationKey: string;
      readonly pageIndex: number | null;
      readonly pageLabel: string | null;
    };

export type OpenOutcome =
  | { kind: "reader" }
  | { kind: "zotero"; url: string }
  | { kind: "file-missing" }
  | { kind: "unknown" }
  | { kind: "failed" };

export class SystemOpenFailed extends Schema.TaggedError<
  SystemOpenFailed,
  { readonly brand: unique symbol }
>()("SystemOpenFailed", {
  url: Schema.String,
  cause: Schema.Defect(),
}) {}

export type ReaderOutcome = "opened" | "file-missing";

export interface TargetReader<E = never> {
  open(
    attachment: ObsidianOpenableAttachment,
    pane: PaneType | boolean,
  ): Effect.Effect<ReaderOutcome, E>;
}

export type NativeOpener = (url: string) => void;

export class TargetOpener extends Context.Service<
  TargetOpener,
  {
    open(
      target: OpenTarget,
      pane: PaneType | boolean,
    ): Effect.Effect<OpenOutcome>;
    follow(
      url: string,
      pane: PaneType | boolean,
    ): Effect.Effect<Effect.Effect<OpenOutcome> | null>;
  }
>()("zotlit/attachment-open/TargetOpener") {}

export class PdfTargetReader extends Context.Service<
  PdfTargetReader,
  TargetReader<ReaderOpenFailed>
>()("zotlit/annotations/PdfTargetReader") {}

export interface TargetOpenerPorts<R, E> {
  readonly reader: Effect.Effect<TargetReader<E>, never, R>;
  readonly native: NativeOpener;
  readonly indexWait?: Duration.Input;
}

interface Claim {
  readonly attachment: ObsidianOpenableAttachment;
  readonly fallback: string | null;
}

const PAGE_NUMBER_RE = /^[1-9]\d*$/;

export function layerTargetOpener<R, E>({
  reader: makeReader,
  native,
  indexWait = "5 seconds",
}: TargetOpenerPorts<R, E>): Layer.Layer<
  TargetOpener,
  never,
  R | AttachmentResolver | PluginSettings | Notifier | ObsidianEnv | VaultDisk
> {
  return Layer.effect(
    TargetOpener,
    Effect.gen(function* () {
      const attachments = yield* AttachmentResolver;
      const settings = yield* PluginSettings;
      const notifier = yield* Notifier;
      const { os } = yield* ObsidianEnv;
      const { basePath } = yield* VaultDisk;
      const reader = yield* makeReader;

      const openable = (
        file: { attachmentKey: string; absolutePath: string },
        subpath: string,
      ): ObsidianOpenableAttachment => ({
        indexedKey: file.attachmentKey,
        label: filename(file.absolutePath),
        openPath: obsidianOpenPath(file.absolutePath, basePath, os),
        absolutePath: file.absolutePath,
        ...(subpath ? { subpath } : {}),
      });

      const opensAnnotations = Effect.map(
        settings.current,
        (current) =>
          current["reader.open-file-links"] &&
          current["reader.open-annotation-links"],
      );

      const toZotero = (url: string) =>
        Effect.try({
          try: () => native(url),
          catch: (cause) => new SystemOpenFailed({ url, cause }),
        }).pipe(Effect.as<OpenOutcome>({ kind: "zotero", url }));

      const read = Effect.fnUntraced(function* (
        attachment: ObsidianOpenableAttachment,
        {
          pane,
          fallback,
        }: { pane: PaneType | boolean; fallback: string | null },
      ) {
        const outcome = yield* reader.open(attachment, pane);
        if (outcome === "opened")
          return { kind: "reader" } satisfies OpenOutcome;
        if (fallback === null) {
          yield* notifier.show(m.notice_pdf_file_missing());
          return { kind: "file-missing" } satisfies OpenOutcome;
        }
        yield* Effect.logDebug(
          "Target handed to Zotero: the reader found no file",
        ).pipe(Effect.annotateLogs({ attachmentKey: attachment.indexedKey }));
        return yield* toZotero(fallback);
      });

      const reported = <E, R>(open: Effect.Effect<OpenOutcome, E, R>) =>
        withOutcome(open, {
          success: () => undefined,
          error: () => m.notice_attachment_open_failed(),
        }).pipe(
          recover(
            () => Effect.void,
            Effect.succeed<OpenOutcome>({ kind: "failed" }),
          ),
          Effect.provideService(Notifier, notifier),
        );

      const lookup = Effect.fnUntraced(function* (attachmentKey: string) {
        const found = yield* attachments.lookup(attachmentKey, {
          wait: indexWait,
        });
        if (found.kind === "pending")
          yield* Effect.logDebug("Target gave up on the Attachment index").pipe(
            Effect.annotateLogs({ attachmentKey }),
          );
        return found;
      });

      const followFile = Effect.fnUntraced(function* (
        parsed: URL,
      ): Effect.fn.Return<Claim | null> {
        const absolutePath = yield* Effect.try(() =>
          fileURLToPath(parsed),
        ).pipe(Effect.orElseSucceed(() => null));
        if (absolutePath === null) return null;
        const resolution = yield* attachments.resolve(absolutePath);
        if (resolution.kind !== "resolved" || !resolution.openable) return null;
        return {
          attachment: openable(
            { attachmentKey: resolution.attachmentKey, absolutePath },
            parsed.hash,
          ),
          fallback: null,
        };
      });

      const followDurable = Effect.fnUntraced(function* (
        url: string,
      ): Effect.fn.Return<Claim | null> {
        const link = parseAnnotationOpenUri(url);
        if (link === null) return null;
        if (!(yield* opensAnnotations)) {
          yield* Effect.logDebug("Durable Annotation Link left to Zotero").pipe(
            Effect.annotateLogs({
              attachmentKey: link.attachmentKey,
              groupID: link.groupID,
              reason: "settings",
            }),
          );
          return null;
        }
        const attachment = yield* attachments.lookup(
          formatIndexedKey(link.attachmentKey, link.groupID),
        );
        if (attachment.kind !== "resolved" || !attachment.openable) {
          yield* Effect.logDebug("Durable Annotation Link left to Zotero").pipe(
            Effect.annotateLogs({
              attachmentKey: link.attachmentKey,
              groupID: link.groupID,
              reason:
                attachment.kind === "resolved"
                  ? "not-openable"
                  : attachment.kind,
            }),
          );
          return null;
        }
        const page =
          link.pageLabel !== null && PAGE_NUMBER_RE.test(link.pageLabel)
            ? Number(link.pageLabel)
            : null;
        return {
          attachment: openable(
            attachment,
            formatAnnotationSubpath({
              page,
              annotation: formatIndexedKey(link.annotationKey, link.groupID),
            }),
          ),
          fallback: url,
        };
      });

      return TargetOpener.of({
        open: Effect.fn("TargetOpener.open")(function* (
          target: OpenTarget,
          pane: PaneType | boolean,
        ) {
          const uri = zoteroUri(target);
          if (uri === null) {
            yield* Effect.logWarning("Target names no Zotero object").pipe(
              Effect.annotateLogs({ attachmentKey: target.attachmentKey }),
            );
            return { kind: "unknown" } satisfies OpenOutcome;
          }
          if (target.kind === "annotation" && !(yield* opensAnnotations)) {
            yield* Effect.logDebug("Target handed to Zotero").pipe(
              Effect.annotateLogs({
                attachmentKey: target.attachmentKey,
                reason: "settings",
              }),
            );
            return yield* toZotero(uri);
          }
          const attachment = yield* lookup(target.attachmentKey);
          if (attachment.kind !== "resolved" || !attachment.openable) {
            yield* Effect.logDebug("Target handed to Zotero").pipe(
              Effect.annotateLogs({
                attachmentKey: target.attachmentKey,
                reason:
                  attachment.kind === "resolved"
                    ? "not-openable"
                    : attachment.kind,
              }),
            );
            return yield* toZotero(uri);
          }
          return yield* read(
            openable(
              attachment,
              target.kind === "annotation"
                ? formatAnnotationSubpath({
                    page:
                      target.pageIndex === null ? null : target.pageIndex + 1,
                    annotation: target.annotationKey,
                  })
                : "",
            ),
            { pane, fallback: uri },
          );
        }, reported),

        follow: Effect.fn("TargetOpener.follow")(
          function* (url: string, _pane: PaneType | boolean) {
            if (!URL.canParse(url)) return null;
            const parsed = new URL(url);
            if (parsed.protocol === "file:") return yield* followFile(parsed);
            if (parsed.protocol === "zotero:") return yield* followDurable(url);
            return null;
          },
          (claim, _url, pane) =>
            Effect.map(claim, (claimed) =>
              claimed === null
                ? null
                : reported(
                    read(claimed.attachment, {
                      pane,
                      fallback: claimed.fallback,
                    }),
                  ).pipe(
                    Effect.withSpan("TargetOpener.follow.open"),
                    withLogCategory("attachment-open"),
                  ),
            ),
          withLogCategory("attachment-open"),
        ),
      });
    }),
  );
}

export function zoteroUri(target: OpenTarget): string | null {
  const attachment = parseIndexedKey(target.attachmentKey);
  if (!attachment) return null;
  if (target.kind === "attachment")
    return attachmentOpenUri(attachment.key, attachment.groupID);
  const annotation = parseIndexedKey(target.annotationKey);
  if (!annotation) return null;
  return annotationOpenUri({
    attachmentKey: attachment.key,
    annotationKey: annotation.key,
    pageLabel: target.pageLabel,
    groupID: attachment.groupID,
  });
}
