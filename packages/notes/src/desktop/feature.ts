import { Effect, FileSystem, Layer, Stream } from "effect";

import { ExcerptPreparation } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import { AnnotationNoteActions } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { registerCitationSuggest } from "@zotlit/citations/obsidian/citation-suggest/register.ts";
import { CitekeyNoteActions } from "@zotlit/citations/obsidian/citekey-editor/note-actions.ts";
import { ProfileStyles } from "@zotlit/citations/obsidian/pandoc/profile-styles.ts";
import { profileRevision } from "@zotlit/obsidian-desktop/profile-revision.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
// The notes as one feature a host composes: Literature Notes and the Note
// Feature, the note import, the Profiles, the Templates and the template
// conversion, the ports of the annotations and the citations they fill, and
// what they register.
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { bindItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import {
  defineFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import type { FeatureContext } from "@zotlit/plugin-shell/obsidian/feature.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { bindNoteActions } from "./note-feature/actions-handle.ts";
import type { NoteActionServices } from "./note-feature/actions-view.ts";
import {
  addNoteFeatureActions,
  noteFeatureFileMenu,
} from "./note-feature/actions.ts";
import { citationTemplateOf } from "./note-feature/citation-template.ts";
import { bindNoteCitations } from "./note-feature/citations-handle.ts";
import type { NoteCitationServices } from "./note-feature/citations-handle.ts";
import { layerCitekeyNoteActions } from "./note-feature/citekey-actions.ts";
import { bindNoteCreation } from "./note-feature/creation-handle.ts";
import type { NoteCreationServices } from "./note-feature/creation-handle.ts";
import { bindNoteFeature } from "./note-feature/handle.ts";
import { layerNoteFeatureNotices } from "./note-feature/notices.ts";
import type { NoteFeatureHandle } from "./note-feature/operations.ts";
import { layerNoteFeature, NoteFeature } from "./note-feature/service.ts";
import { batchUpdateNotices } from "./note-feature/update-single.ts";
import { layerAnnotationNoteActions } from "./note-feature/view-actions.ts";
import { bindBatchImport } from "./note-import/batch-import-handle.ts";
import type { BatchImportServices } from "./note-import/batch-import.ts";
import {
  importChildNotes,
  importStarter,
  layerNoteImportCommands,
} from "./note-import/commands.ts";
import { layerNoteImporter, NoteImporter } from "./note-import/service.ts";
import { createNoteImportView } from "./note-import/view.ts";
import { layerProfileActions } from "./profile/actions.ts";
import { interactiveCreation } from "./profile/dialogs.ts";
import { bindTemplateData } from "./template/data-handle.ts";
import {
  layerTemplateDataReads,
  TemplateDataReads,
} from "./template/data-reads.ts";
import type { TemplateDataServices } from "./template/data.ts";
import { readMigrationVerificationData } from "./template/migration-data.ts";
import {
  layerTemplateMigration,
  TemplateMigration,
  TemplateMigrationPrompt,
} from "./template/migration.ts";

import { noteImportSettings } from "#core/note-import/settings.ts";
import { ItemMatchQuery } from "#core/profile-selection/item-matches.ts";
import { templateSettings } from "#core/template/settings.ts";
import { noteImportPageItems } from "#obsidian/note-import/settings-page.ts";
import { layerProfileStyles } from "#obsidian/profile/profile-styles.ts";
import { layerProfile, Profile } from "#obsidian/profile/service.ts";
import {
  isProfileControlKey,
  profileControlValue,
  setProfileControlValue,
} from "#obsidian/profile/setting-controls.ts";
import { profileSettings } from "#obsidian/profile/settings.ts";
import { layerCitationTemplateActions } from "#obsidian/template/actions.ts";
import { layerTemplate, Template } from "#obsidian/template/service.ts";

/**
 * The Note Feature's handle over the built graph, which the protocol
 * handlers, the Library View's item actions and the Citation Suggester call.
 */
export function noteFeatureHandle({
  app,
  bridge,
  read,
}: Pick<FeatureContext, "app" | "bridge" | "read">): NoteFeatureHandle {
  return bindNoteFeature(bridge, read(NoteFeature), {
    ...bindNoteCitations(bridge, read(Effect.context<NoteCitationServices>())),
    ...bindNoteCreation(
      bridge,
      read(Effect.context<NoteCreationServices>()),
      interactiveCreation(app),
    ),
  });
}

/** The note actions and the child-note import, as the commands and the file menu call them. */
function noteActionDeps(ctx: FeatureContext) {
  const { app, bridge, read } = ctx;
  const creation = interactiveCreation(app);
  const noteImportView = createNoteImportView(app, creation);
  const noteActions = bindNoteActions(
    bridge,
    read(Effect.context<NoteActionServices>()),
    { creation, view: noteImportView, notices: batchUpdateNotices(app) },
  );
  // Import child notes on the file menu, as the command runs it.
  const startImport = importStarter(
    bridge,
    read(Effect.context<BatchImportServices | Notifier>()),
  );
  const importChildNotesOf = (indexedKey: string) =>
    startImport(
      importChildNotes({ view: noteImportView, bridge }, app, indexedKey),
    );
  return {
    app,
    noteActions,
    importChildNotes: importChildNotesOf,
    noteImportView,
  };
}

export const notes = defineFeature({
  name: "notes",
  settings: [profileSettings, templateSettings, noteImportSettings],
  services: [
    serviceGroup(
      "Template",
      { provides: [Template], requires: [] },
      layerTemplate,
    ),
    serviceGroup(
      "Profile",
      { provides: [Profile], requires: [NoteIndex, Template] },
      layerProfile(profileRevision),
    ),
    // The citations read the Profiles through their port.
    serviceGroup(
      "ProfileStyles",
      { provides: [ProfileStyles], requires: [Profile] },
      layerProfileStyles,
    ),
    // The migration verifies a conversion against a real in-scope item.
    serviceGroup(
      "TemplateMigration",
      {
        provides: [TemplateMigration],
        requires: [
          TemplateMigrationPrompt,
          LibraryScope,
          NoteIndex,
          Template,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      Layer.unwrap(
        Effect.gen(function* () {
          const prompt = yield* TemplateMigrationPrompt;
          return layerTemplateMigration({
            openPrompt: prompt.openPrompt,
            loadVerificationData: readMigrationVerificationData,
          });
        }),
      ),
    ),
    serviceGroup(
      "NoteImporter",
      {
        provides: [NoteImporter],
        requires: [
          Template,
          AttachmentImport,
          ExcerptPreparation,
          NoteIndex,
          Profile,
          ZoteroPref,
        ],
      },
      layerNoteImporter,
    ),
    // The Note Feature plans creations through ZotLit Query, so it builds
    // above the services that query reads.
    serviceGroup(
      "NoteFeature",
      {
        provides: [NoteFeature],
        requires: [
          AttachmentImport,
          ExcerptPreparation,
          ItemMatchQuery,
          NoteIndex,
          Profile,
          Template,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      layerNoteFeature,
    ),
    serviceGroup(
      "TemplateDataReads",
      {
        provides: [TemplateDataReads],
        requires: [NoteIndex, Template, ZoteroPref, ZoteroReads],
      },
      layerTemplateDataReads,
    ),
    // The citekey editor creates notes through this port.
    serviceGroup(
      "CitekeyNoteActions",
      {
        provides: [CitekeyNoteActions],
        requires: [
          FileSystem.FileSystem,
          LibraryScope,
          NoteFeature,
          NoteIndex,
          Profile,
          Template,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      Layer.unwrap(
        Effect.map(ObsidianApp, (app) =>
          layerCitekeyNoteActions(interactiveCreation(app)),
        ),
      ),
    ),
    // An Annotation inserts into a note through this port, from the
    // Annotation View and from the PDF reader alike.
    serviceGroup(
      "AnnotationNoteActions",
      {
        provides: [AnnotationNoteActions],
        requires: [
          AnnotationRepository,
          UseLedger,
          ExcerptPreparation,
          NoteIndex,
          Profile,
          Template,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      layerAnnotationNoteActions,
    ),
  ],
  registrations: [
    registration("CitationTemplateActions", layerCitationTemplateActions),
    registration("NoteFeatureNotices", layerNoteFeatureNotices),
    registration(
      "NoteImportCommands",
      Layer.unwrap(
        Effect.gen(function* () {
          const app = yield* ObsidianApp;
          return layerNoteImportCommands({
            view: createNoteImportView(app, interactiveCreation(app)),
          });
        }),
      ),
    ),
    registration("ProfileActions", layerProfileActions),
  ],
  settingTab: {
    entries: {
      "note-import": (ctx) => [
        {
          type: "page",
          id: "settings_page_note_import",
          name: m.settings_page_note_import(),
          desc: m.settings_page_note_import_desc(),
          items: noteImportPageItems(ctx),
        },
      ],
    },
    controls: [
      {
        claims: isProfileControlKey,
        read: (key) => profileControlValue(key as never),
        write: (key, value) => setProfileControlValue(key as never, value),
      },
    ],
    rebuild: [
      Effect.map(Profile, (profile) => Stream.drop(profile.changes, 1)),
      Effect.map(Template, (template) => template.compileEvents),
      Effect.map(PluginSettings, (settings) =>
        settings.changes.pipe(
          Stream.map((current) => current["note.template-conversion-pending"]),
          Stream.changes,
          Stream.drop(1),
        ),
      ),
    ],
  },
  handles: (ctx) => {
    const { bridge, read } = ctx;
    const profile = read(Profile);
    const { noteActions, importChildNotes, noteImportView } =
      noteActionDeps(ctx);
    return {
      template: read(Template),
      profile,
      // The Default Profile, as the Template Workbench opens it from a note.
      defaultProfile: {
        get defaultDocumentPath() {
          return bridge.runSync(profile.defaultDocumentPath);
        },
      },
      templateData: bindTemplateData(
        bridge,
        read(Effect.context<TemplateDataServices>()),
      ),
      noteFeature: noteFeatureHandle(ctx),
      importChildNotes,
      noteImportView,
      batchImport: bindBatchImport(
        bridge,
        read(Effect.context<BatchImportServices>()),
        { view: noteImportView },
      ),
      noteActions,
    };
  },
  onload: (ctx) => {
    const { plugin, app, bridge, read } = ctx;
    const deps = noteActionDeps(ctx);
    addNoteFeatureActions(plugin, deps);
    // The Citation Suggester inserts with the notes feature's Citation
    // Template, so the feature that fills that template registers it.
    registerCitationSuggest(plugin, {
      app,
      lookup: bindItemLookup(bridge, read(ItemLookup)),
      citationTemplate: citationTemplateOf(noteFeatureHandle(ctx)),
      settings: read(PluginSettings),
      bridge,
      citationLookup: read(CitationLookup),
      citationIndex: read(CitationIndex),
      useLedger: read(UseLedger),
    });
    return { fileMenu: { "note-feature": noteFeatureFileMenu(deps) } };
  },
});
