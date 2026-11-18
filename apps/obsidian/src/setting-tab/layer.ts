// The setting tab as a scoped layer: it registers the tab, keeps its
// definitions current, and removes it when its Scope closes.
import { Duration, Effect, Layer, Stream } from "effect";

import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import {
  LibraryScope,
  scopeChanges,
} from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { LocalBridge } from "@/services/local-bridge/service.ts";
import { Profile } from "@/services/profile/service.ts";
import { Template } from "@/services/template/service.ts";

import type { SettingTabContext } from "./context.ts";
import { makeSettingTab } from "./effect-tab.ts";
import { ZotLitSettingTab } from "./index.ts";

/**
 * How long the tab waits for changes to settle before it rebuilds. Obsidian
 * re-renders every `render` row on a rebuild, and startup moves several
 * services at once.
 */
const REBUILD_SETTLE = Duration.millis(50);

/** The pending flags that include or leave out the reminder rows. */
const reminderFlags = (settings: Readonly<Settings>) =>
  [
    settings["release.migration-pending"],
    settings["note.template-conversion-pending"],
  ] as const;

/** Each element of `stream` as a bare "something moved". */
const signal = <A>(stream: Stream.Stream<A>): Stream.Stream<void> =>
  Stream.map(stream, () => undefined);

/**
 * The tab over the plugin's services. `webWorkbenchEnabled` is the build's
 * Template Workbench flag, which shows or hides the web editor rows.
 */
export function layerSettingTab({
  webWorkbenchEnabled,
}: Pick<SettingTabContext, "webWorkbenchEnabled">) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* PluginHost;
      const settings = yield* PluginSettings;
      let tab: ZotLitSettingTab | undefined;
      const service = yield* makeSettingTab(() => tab?.update());
      tab = yield* host.addSettingTab(
        (plugin) =>
          new ZotLitSettingTab(plugin, { webWorkbenchEnabled, tab: service }),
      );

      // Rows that are included or left out, not toggled through `visible`,
      // follow these. A scalar `control` edit is read on Obsidian's own render
      // cycle, so it never rebuilds and never steals focus from an input.
      const localServer = yield* LocalServer;
      const profile = yield* Profile;
      const template = yield* Template;
      const pandocEngine = yield* PandocEngine;
      const chineseSegmenter = yield* ChineseSegmenter;
      const libraryScope = yield* LibraryScope;
      const attachmentImport = yield* AttachmentImport;
      const localBridge = yield* LocalBridge;
      const languagePack = yield* LanguagePack;
      yield* forkEach(
        Stream.mergeAll(
          [
            // The Local server rows name the port the listener bound.
            signal(Stream.drop(localServer.effectivePortChanges, 1)),
            // The Workbench Connection row stands only while a connection does.
            signal(Stream.drop(localBridge.changes, 1)),
            // The Language Pack row stands only while a pack is offered.
            signal(Stream.drop(languagePack.changes, 1)),
            signal(Stream.drop(profile.changes, 1)),
            template.compileEvents,
            signal(Stream.drop(pandocEngine.changes, 1)),
            signal(Stream.drop(chineseSegmenter.changes, 1)),
            // A database refresh, a group rename, or a repair moves the scope.
            signal(scopeChanges(libraryScope.changes)),
            // The Approved folders list names each grant.
            signal(Stream.drop(attachmentImport.approvedFoldersChanges, 1)),
            signal(
              settings.changes.pipe(
                Stream.map((current) => reminderFlags(current)),
                Stream.changesWith(
                  (left, right) => left[0] === right[0] && left[1] === right[1],
                ),
                Stream.drop(1),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        ).pipe(Stream.debounce(REBUILD_SETTLE)),
        () => service.update,
      );
    }),
  );
}
