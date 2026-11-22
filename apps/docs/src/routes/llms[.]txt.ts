import { createFileRoute } from "@tanstack/react-router";

import { getLlmsIndex, plainTextHeaders } from "@/lib/markdown-editions.tsx";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () => new Response(getLlmsIndex(), { headers: plainTextHeaders }),
    },
  },
});
