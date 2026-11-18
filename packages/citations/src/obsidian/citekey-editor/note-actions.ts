// The Literature Notes a citekey opens, which the notes feature owns: the note
// to open among an Item's notes, and a new note for an Item that has none. The
// notes feature provides the layer.
import { Context } from "effect";
import type { Effect } from "effect";
import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";

export class CitekeyNoteActions extends Context.Service<
  CitekeyNoteActions,
  {
    /**
     * The Literature Note to open among `notes`, the notes of one Item; a
     * notice names the others when there are several.
     */
    pickExisting(notes: readonly TFile[]): TFile | undefined;
    /**
     * Creates the Literature Note of `item` at once, asking for a Profile only
     * where none resolves.
     *
     * @returns the new note, or `null` when the researcher cancels.
     */
    create(item: Item): Effect.Effect<TFile | null, unknown>;
  }
>()("zotlit/citekey-editor/CitekeyNoteActions") {}
