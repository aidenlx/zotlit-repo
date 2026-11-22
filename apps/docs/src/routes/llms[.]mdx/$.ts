import { createFileRoute } from "@tanstack/react-router";

import { missingReleaseResponse } from "@/lib/beta-fallback.ts";
import {
  getMarkdownEdition,
  markdownHeaders,
} from "@/lib/markdown-editions.tsx";
import { parseContentRoute, suffixEditionUrl } from "@/lib/markdown-routes.ts";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";

export const Route = createFileRoute("/llms.mdx/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const locale = getLocale();
        const page = parseContentRoute(params._splat ?? "");
        const edition = page && (await getMarkdownEdition(page, { locale }));
        if (edition === undefined) {
          if (page?.section !== "changelog" || page.slugs.length === 0) {
            return new Response("Not found", { status: 404 });
          }
          return missingReleaseResponse(page.slugs.join("/"), {
            release: localizeHref(suffixEditionUrl(page), { locale }),
            changelog: localizeHref(
              suffixEditionUrl({ section: "changelog", slugs: [] }),
              { locale },
            ),
          });
        }

        return new Response(edition, { headers: markdownHeaders });
      },
    },
  },
});
