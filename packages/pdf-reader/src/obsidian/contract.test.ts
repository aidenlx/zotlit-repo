import type {
  ExtensionContext,
  HeadlessDocument,
  PdfEngine,
  PdfReader,
  ReaderDocument,
  ReaderPage,
} from "#/core/index.ts";
import type {
  ObsidianHostContext,
  OpenOptions,
  PdfReaderRegistration,
} from "#/obsidian/index.ts";
import { expectTypeOf, it } from "vitest";

import type * as Contract from "@zotlit/reader-api";

it("conforms to @zotlit/reader-api v1 in the direction each value crosses", () => {
  expectTypeOf<PdfReader>().toExtend<Contract.PdfReader>();
  expectTypeOf<ReaderPage>().toExtend<Contract.ReaderPage>();
  expectTypeOf<ReaderDocument>().toExtend<Contract.ReaderDocument>();
  expectTypeOf<HeadlessDocument>().toExtend<Contract.HeadlessDocument>();
  expectTypeOf<ObsidianHostContext>().toExtend<Contract.ReaderHostContext>();
  expectTypeOf<ExtensionContext<ObsidianHostContext>>().toExtend<
    Contract.ExtensionContext<Contract.ReaderHostContext>
  >();
  expectTypeOf<Contract.DocumentSource>().toExtend<
    Parameters<PdfEngine["load"]>[0]
  >();
  expectTypeOf<Contract.LoadOptions>().toExtend<
    NonNullable<Parameters<PdfEngine["load"]>[1]>
  >();
  expectTypeOf<Contract.OpenOptions>().toExtend<OpenOptions>();
  expectTypeOf<
    PdfReaderRegistration["api"]
  >().toEqualTypeOf<Contract.ReaderApi>();
});
