import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";

import { isSiteLocale } from "@/lib/i18n.ts";
import { source } from "@/lib/source.ts";

const searchApi = createFromSource(source);

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const locale = new URL(request.url).searchParams.get("locale");
        if (locale !== null && !isSiteLocale(locale)) {
          return Response.json(
            { error: "Unsupported locale" },
            { status: 400 },
          );
        }
        return searchApi.GET(request);
      },
    },
  },
});
