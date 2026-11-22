import { Schema } from "effect";

import { formatErrorMessage } from "@zotlit/obsidian-kit/toast.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

export class ItemUnavailable extends Schema.TaggedError<
  ItemUnavailable,
  { readonly brand: unique symbol }
>()("ItemUnavailable", {
  indexedKey: Schema.String,
  reason: Schema.Literals(["missing", "child", "degraded"]),
}) {
  override get message(): string {
    return this.reason === "degraded"
      ? m.template_workbench_database_unavailable()
      : m.workbench_example_missing_item();
  }
}

export class PreviewItemMissing extends Schema.TaggedError<
  PreviewItemMissing,
  { readonly brand: unique symbol }
>()("PreviewItemMissing", {}) {
  override get message(): string {
    return m.workbench_example_missing_item();
  }
}

export class PartialPreviewFailed extends Schema.TaggedError<
  PartialPreviewFailed,
  { readonly brand: unique symbol }
>()("PartialPreviewFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return formatErrorMessage(this.cause);
  }
}
