import { Schema } from "effect";

import { NotePathUnavailable } from "./note-path.ts";

import { plainTemplateError } from "#core/template/errors.ts";

export class ItemNotFound extends Schema.TaggedError<
  ItemNotFound,
  { readonly brand: unique symbol }
>()("ItemNotFound", {
  indexedKey: Schema.String,
  message: Schema.String,
}) {}

export class NoteWriteAborted extends Schema.TaggedError<
  NoteWriteAborted,
  { readonly brand: unique symbol }
>()("NoteWriteAborted", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return Error.isError(this.cause) ? this.cause.message : String(this.cause);
  }
}

export class ProfileSwitchRollbackFailed extends Schema.TaggedError<
  ProfileSwitchRollbackFailed,
  { readonly brand: unique symbol }
>()("ProfileSwitchRollbackFailed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export function plainNoteError(error: unknown): unknown {
  return error instanceof NoteWriteAborted ||
    error instanceof NotePathUnavailable
    ? error.cause
    : plainTemplateError(error);
}
