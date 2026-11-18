// Shared view state for the last Use of each Item.
import { Effect, Stream } from "effect";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";

import { UseLedger } from "./service.ts";
import type { Ledger } from "./service.ts";

export const useLedgerAtom = held<Ledger>(
  Stream.unwrap(Effect.map(UseLedger, (ledger) => ledger.changes)),
  {},
);
