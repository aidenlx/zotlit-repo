import { sanitizeHTMLToDom } from "obsidian";
import { useCallback } from "react";

export function useSanitizedHtml<E extends HTMLElement>(html: string) {
  return useCallback(
    (el: E | null) => {
      if (el) el.replaceChildren(sanitizeHTMLToDom(html));
    },
    [html],
  );
}
