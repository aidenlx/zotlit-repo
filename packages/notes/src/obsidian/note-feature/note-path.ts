import type { ProfileBindingSettings } from "#obsidian/profile/bindings.ts";
import type { ResolvedLiteratureNoteTemplate } from "#obsidian/template/service.ts";
// A new Literature Note's vault path, rendered and checked against the Vault.
import { Effect, Schema } from "effect";

import { buildFilenameContext } from "@zotlit/db";
import type { Item, ItemTag, TemplateCollection } from "@zotlit/db";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { creatorSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import { hasSuffixMarker, joinNotePath } from "@zotlit/templates";

import {
  baseNoteName,
  MAX_SUFFIX_ATTEMPTS,
  noFreeName,
  suffixedNoteName,
} from "#core/note-feature/filename.ts";
import { getProfileBinding } from "#obsidian/profile/bindings.ts";
import { Template } from "#obsidian/template/service.ts";

/**
 * No free path came of the rendered filename: it is empty, or each `suffix()`
 * attempt collided. `message` is the text a preview shows; `cause` holds what
 * the filename resolution threw.
 */
export class NotePathUnavailable extends Schema.TaggedError<
  NotePathUnavailable,
  { readonly brand: unique symbol }
>()("NotePathUnavailable", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const unavailable = (cause: unknown) =>
  new NotePathUnavailable({
    message: Error.isError(cause) ? cause.message : String(cause),
    cause,
  });

/** `data` rendered by `document`'s filename template. */
export const renderDocumentFilename = (
  document: Pick<ResolvedLiteratureNoteTemplate, "renderFilename">,
  data: object,
) =>
  Effect.try({ try: () => document.renderFilename(data), catch: unavailable });

/**
 * The free path of `rendered` under `folder`. A path the vault holds, or one
 * of `reserved`, is taken. On a collision, each `suffix()` marker is filled
 * with a random alphanumeric id; without a marker the rendered path is
 * returned as it is, taken or not.
 */
export const resolveRenderedNotePath = Effect.fnUntraced(function* (
  folder: string,
  rendered: string,
  reserved?: ReadonlySet<string>,
) {
  const vault = yield* Vault;
  const name = (resolve: () => string) =>
    Effect.try({ try: resolve, catch: unavailable });
  const taken = (rel: string) => {
    const path = joinNotePath(folder, rel);
    return reserved?.has(path) === true
      ? Effect.succeed(true)
      : Effect.map(vault.getAbstractFileByPath(path), (file) => file !== null);
  };
  const base = yield* name(() => baseNoteName(rendered));
  if (!hasSuffixMarker(rendered) || !(yield* taken(base)))
    return { path: joinNotePath(folder, base) };
  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const rel = yield* name(() => suffixedNoteName(rendered));
    if (!(yield* taken(rel))) return { path: joinNotePath(folder, rel) };
  }
  return yield* unavailable(noFreeName(base));
});

/**
 * The path `item`'s note takes under `settings`' Literature folder, its
 * filename rendered by `document`, or by the settings template without one.
 */
export const resolveNotePath = Effect.fnUntraced(function* (
  item: Item,
  options: {
    itemTags: readonly ItemTag[];
    itemCollections: readonly TemplateCollection[];
    settings: ProfileBindingSettings;
    document?: Pick<ResolvedLiteratureNoteTemplate, "renderFilename">;
    reservedPaths?: ReadonlySet<string>;
  },
) {
  const data = buildFilenameContext({
    item,
    tags: options.itemTags,
    collections: options.itemCollections,
    authorsShort: creatorSummary,
  });
  const rendered = options.document
    ? yield* renderDocumentFilename(options.document, data)
    : yield* (yield* Template).renderFilename(data);
  return yield* resolveRenderedNotePath(
    getProfileBinding(options.settings, "note.literature-folder"),
    rendered,
    options.reservedPaths,
  );
});
