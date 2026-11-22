import { Context, Effect, Layer } from "effect";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import {
  DATA_DIR,
  openResolver,
} from "@zotlit/plugin-services/obsidian/attachment-resolver/__fixtures__.ts";
import type { ResolverHarnessOptions } from "@zotlit/plugin-services/obsidian/attachment-resolver/__fixtures__.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { defaults } from "./settings.ts";

import { layerTargetOpener, TargetOpener } from "#desktop/attachment-open/open-target.ts";
import type { NativeOpener, ReaderOutcome } from "#desktop/attachment-open/open-target.ts";
import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";

export const VAULT = "/fixture/vault";

export const FILES = {
  rougier: `${VAULT}/attachments/rougier-2014.pdf`,
  stored: `${DATA_DIR}/storage/PDFSTR22/sakimas song.pdf`,
  grouped: `${DATA_DIR}/storage/RGRGRUP9/shared.pdf`,
} as const;

export const OPENER_ROWS = `
  insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
  insert into groups (groupID, libraryID, name)
    values (4200309, 2, 'Shared Reading');
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (20, 1, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'SAKIMA22'),
      (21, 2, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'PDFSTR22'),
      (22, 2, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'EPUBSTR2'),
      (24, 2, '2025-02-17 12:00:00', '2025-02-17 12:00:00', 1, 'LINKURL2'),
      (30, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RGRGRUP9'),
      (31, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RUGIERG9'),
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (60, 2, '2025-02-05 12:00:00', '2025-02-05 12:00:00', 1, 'RGRCPYB8'),
      (61, 1, '2025-02-05 12:00:00', '2025-02-05 12:00:00', 1, 'RUGIERC8');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (21, 20, 0, 'application/pdf', 'storage:sakimas song.pdf'),
      (22, 20, 0, 'application/epub+zip', 'storage:sakimas-song.epub'),
      (24, 20, 3, 'text/html', null),
      (30, 31, 0, 'application/pdf', 'storage:shared.pdf'),
      (47, 46, 2, 'application/pdf', '${FILES.rougier}'),
      (60, 61, 2, 'application/pdf', '${FILES.rougier}');
`;

export interface OpenerHarnessOptions extends Omit<
  ResolverHarnessOptions,
  "rows"
> {
  missing?: readonly string[];
  broken?: readonly string[];
  native?: NativeOpener;
  settings?: Settings;
}

export async function openOpener(
  {
    missing = [],
    broken = [],
    native,
    settings = defaults,
    ...options
  }: OpenerHarnessOptions = {},
  context: Context.Context<never> = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const opened: { attachment: ObsidianOpenableAttachment; pane: unknown }[] =
    [];
  const handed: string[] = [];
  const harness = await openResolver(
    { rows: OPENER_ROWS, ...options },
    context,
  );
  stack.defer(() => harness.close());
  const notifier = testNotifier();
  const runtime = buildRuntime(
    layerTargetOpener({
      reader: Effect.succeed({
        open: (attachment, pane): Effect.Effect<ReaderOutcome, Error> => {
          if (broken.includes(attachment.absolutePath))
            return Effect.fail(new Error("the reader failed"));
          if (missing.includes(attachment.absolutePath))
            return Effect.succeed("file-missing");
          opened.push({ attachment, pane });
          return Effect.succeed("opened");
        },
      }),
      native: native ?? ((url) => void handed.push(url)),
      platform: "linux",
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AttachmentResolver, harness.service),
          Layer.mock(PluginSettings, { current: Effect.sync(() => settings) }),
          Layer.succeed(
            ObsidianEnv,
            stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
              basePath: VAULT,
            }),
          ),
          notifier.layer,
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const opener = runtime.runSync(TargetOpener);
  const owned = stack.move();
  return {
    ...harness,
    opener,
    bridge: effectBridge(runtime),
    opened,
    handed,
    notices: notifier.notices,
    close: () => owned.disposeAsync(),
  };
}

export const openerFixture = Effect.fnUntraced(function* (
  options: OpenerHarnessOptions = {},
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openOpener(options, context)),
    (harness) => Effect.promise(() => harness.close()),
  );
});

export async function openerHarness(
  stack: AsyncDisposableStack,
  options: OpenerHarnessOptions = {},
) {
  const harness = await openOpener(options);
  stack.defer(() => harness.close());
  return harness;
}
