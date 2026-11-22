import { Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { viewRuntime, held } from "@zotlit/obsidian-kit/view-atoms.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { Template } from "./service.ts";

import { templateSettings } from "#core/template/settings.ts";

export const templateRevisionAtom = held(
  Stream.unwrap(
    Effect.map(Template, (template) =>
      template.compileEvents.pipe(
        Stream.scan(
          () => 0,
          (revision) => revision + 1,
        ),
      ),
    ),
  ),
  0,
);

export const partialDocumentsAtom = viewRuntime.atom((get) => {
  get(templateRevisionAtom);
  return Effect.gen(function* () {
    const template = yield* Template;
    const status = yield* template.status;
    return status.state === "loaded" ? yield* template.getPartialDocuments : [];
  });
});
export const partialNamesAtom = Atom.map(partialDocumentsAtom, (result) =>
  AsyncResult.isSuccess(result)
    ? result.value.map((partial) => partial.name)
    : [],
);

export const javascriptTemplatesEnabledAtom = viewRuntime.atom((get) => {
  get(templateRevisionAtom);
  return Effect.flatMap(
    Template,
    (template) => template.javascriptTemplatesEnabled,
  );
});

export const templateFolderAtom = held(
  Stream.unwrap(
    Effect.map(PluginSettings, (service) =>
      Stream.map(service.changes, (settings) => settings["template.folder"]),
    ),
  ),
  templateSettings.defaults["template.folder"],
);
