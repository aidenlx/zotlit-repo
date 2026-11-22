import { createFileRoute } from "@tanstack/react-router";

import { getReleaseSnapshot, releaseFactHandlers } from "@/lib/release-data.ts";

export const Route = createFileRoute("/api/release-snapshot")({
  server: { handlers: releaseFactHandlers(getReleaseSnapshot) },
});
