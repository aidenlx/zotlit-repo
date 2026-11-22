import { Effect } from "effect";

import { logServices, withLogCategory } from "#effect-log.ts";

export type ClipboardRepresentation = "rich" | "text";

export interface RichClipboardPayload {
  html: string;
  text: string;
}

export async function writeClipboardRichText({
  html,
  text,
}: RichClipboardPayload): Promise<ClipboardRepresentation> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return "rich";
  } catch (error) {
    Effect.runSyncWith(logServices)(
      Effect.logWarning(
        "The rich clipboard write did not land; writing text",
      ).pipe(
        Effect.annotateLogs({
          error,
        }),
        withLogCategory("clipboard"),
      ),
    );
    await navigator.clipboard.writeText(text);
    return "text";
  }
}
