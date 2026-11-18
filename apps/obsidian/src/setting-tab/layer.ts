// The setting tab as a scoped layer: it registers the tab, keeps its
// definitions current, and removes it when its Scope closes.
import { Duration, Effect, Layer, Stream } from "effect";

import type { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import type { CapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import type { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import type { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import type { Release } from "@zotlit/library-view/obsidian/release/service.ts";
import type { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import type { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import {
  LibraryScope,
  scopeChanges,
} from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import type { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { makeSettingTab } from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import type { Customize } from "@zotlit/template-workbench/desktop/local-bridge/customize.ts";
import { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

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

// The tab layer's whole context, which every row the host composes may read.
declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    Profile: Profile;
    Template: Template;
    ZoteroPref: ZoteroPref;
    ZoteroReads: ZoteroReads;
    LibraryScope: LibraryScope;
    LocalServer: LocalServer;
    Release: Release;
    AnnotationRepository: AnnotationRepository;
    CapabilityNotices: CapabilityNotices;
    ZoteroLocalApi: ZoteroLocalApi;
    CitationIndex: CitationIndex;
    PandocEngine: PandocEngine;
    ChineseSegmenter: ChineseSegmenter;
    AttachmentImport: AttachmentImport;
    LocalBridge: LocalBridge;
    Customize: Customize;
    TemplateWorkbenchLauncher: TemplateWorkbenchLauncher;
    LanguagePack: LanguagePack;
    ExcerptImageService: ExcerptImageService;
    ExcerptDisplays: ExcerptDisplays;
    NoteFeature: NoteFeature;
    NoteIndex: NoteIndex;
  }
}
