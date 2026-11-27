import type { Effect } from "effect";
import { Context } from "effect";
import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";

export class CitekeyNoteActions extends Context.Service<
  CitekeyNoteActions,
  {
    pickExisting(notes: readonly TFile[]): TFile | undefined;
    create(item: Item): Effect.Effect<TFile | null, unknown>;
  }
>()("zotlit/citekey-editor/CitekeyNoteActions") {}
