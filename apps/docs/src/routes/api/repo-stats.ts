import { createFileRoute } from "@tanstack/react-router";

import { getRepoStats, releaseFactHandlers } from "@/lib/release-data.ts";

export const Route = createFileRoute("/api/repo-stats")({
  server: { handlers: releaseFactHandlers(getRepoStats) },
});
