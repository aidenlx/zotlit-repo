import { createFileRoute } from "@tanstack/react-router";

import { renderSitemap, xmlHeaders } from "@/lib/sitemap.ts";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () =>
        new Response(await renderSitemap(), { headers: xmlHeaders }),
    },
  },
});
