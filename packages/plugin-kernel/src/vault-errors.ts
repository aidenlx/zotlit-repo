import { Schema } from "effect";

export class FileExists extends Schema.TaggedError<
  FileExists,
  { readonly brand: unique symbol }
>()("FileExists", {
  path: Schema.String,
}) {
  override get message(): string {
    return "File already exists.";
  }
}

export class FileNotFound extends Schema.TaggedError<
  FileNotFound,
  { readonly brand: unique symbol }
>()("FileNotFound", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export class VaultError extends Schema.TaggedError<
  VaultError,
  { readonly brand: unique symbol }
>()("VaultError", {
  operation: Schema.String,
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class VaultFolderBlockedError extends Schema.TaggedError<
  VaultFolderBlockedError,
  { readonly brand: unique symbol }
>()("VaultFolderBlockedError", {
  path: Schema.String,
}) {
  override get message(): string {
    return `Cannot create folder; a file exists at "${this.path}"`;
  }
}

export const vaultError =
  (operation: string, path: string) =>
  (cause: unknown): VaultError =>
    new VaultError({
      operation,
      path,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
