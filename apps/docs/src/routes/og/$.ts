import { createFileRoute } from "@tanstack/react-router";

import { missingReleaseResponse } from "@/lib/beta-fallback.ts";
import { ogImageUrl } from "@/lib/shared.ts";

const cardFile = "image.webp";

export const Route = createFileRoute("/og/$")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const segments = (params._splat ?? "").split("/").filter(Boolean);
        const slugs = segments.slice(1, -1);
        const isChangelogEntry =
          segments[0] === "changelog" &&
          segments.at(-1) === cardFile &&
          slugs.length > 0;

        return isChangelogEntry
          ? missingReleaseResponse(slugs.join("/"), {
              release: ogImageUrl("changelog", { slugs }),
              changelog: ogImageUrl("changelog"),
            })
          : new Response("Not found", { status: 404 });
      },
    },
  },
});
