import { createFileRoute } from "@tanstack/react-router";

import { plainTextHeaders } from "@/lib/markdown-editions.tsx";
import { baseURL } from "@/lib/shared.ts";

const disallow = [
  "/api/",
  "/llms.txt",
  "/llms-full.txt",
  "/llms.mdx/",
  "/.well-known/agent-skills/",
];

const robots = `User-Agent: *
Allow: /
${disallow.map((path) => `Disallow: ${path}`).join("\n")}

Sitemap: ${baseURL}/sitemap.xml
`;

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => new Response(robots, { headers: plainTextHeaders }),
    },
  },
});
