export type {
  HeadlessDocument,
  ReaderDocument,
} from "#/core/document/document.ts";
export { createPdfEngine } from "#/core/engine/engine.ts";
export type {
  DocumentSource,
  PdfEngine,
  PdfEngineOptions,
} from "#/core/engine/engine.ts";
export { PdfLoadError } from "#/core/engine/error.ts";
export type { PdfLoadFailure } from "#/core/engine/error.ts";
export type {
  LegacyText,
  LegacyTextRequest,
  MenuItem,
  ReaderHost,
} from "#/core/host.ts";
export type { AttachContext } from "#/core/extensions/host.ts";
export { mountExtensible, mountReader } from "#/core/reader.ts";
export type { ExtensibleReader, LiveExtensions } from "#/core/reader.ts";
export { parseSubpath } from "#/core/subpath/parse.ts";
export type { Subpath } from "#/core/subpath/parse.ts";
export type {
  ContextTarget,
  ExtensionContext,
  FailureReason,
  FindState,
  MountOptions,
  NavigateOutcome,
  NavigationTarget,
  Observable,
  PageBox,
  PageChangeCause,
  PdfReader,
  PdfRect,
  ReaderCommand,
  ReaderEvents,
  ReaderExtension,
  ReaderIntent,
  ReaderPage,
  ReaderPosition,
  ReaderSlot,
  ReaderState,
  ReaderZoom,
  SurfaceKind,
} from "#/core/types.ts";
export { englishStrings } from "#/generated/strings.ts";
export type { ReaderStringKey } from "#/generated/strings.ts";
