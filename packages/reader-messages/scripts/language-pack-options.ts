import { fileURLToPath } from "node:url";

export { TARGET_LOCALE_MESSAGE_PREFIXES } from "@zotlit/plugin-messages/language-pack-options";

export const INCLUDE_MESSAGE_PREFIXES = [
  "pdf_reader_",
  "reader_",
  "notice_startup_",
  "notice_language_pack_",
  "settings_language_pack_",
  "settings_log_",
] as const;

export const INCLUDE_MESSAGES = [
  "modal_cancel",
  "settings_failed_save",
  "settings_failed_language_pack_reset",
  "settings_page_advanced",
  "settings_page_advanced_desc",
  "settings_advanced_logging_heading",
  "settings_advanced_recovery_heading",
  "notice_export_log_file_failed",
  "notice_open_log_file_failed",
] as const;

export const READER_MESSAGES_DIRECTORY = fileURLToPath(
  new URL("../generated", import.meta.url),
);
