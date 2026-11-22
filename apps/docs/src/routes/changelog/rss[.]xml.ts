import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "feed";

import { baseURL, changelogRoute } from "@/lib/shared.ts";
import { getChangelogPages } from "@/lib/source.ts";
import { m } from "@/paraglide/messages.js";

function renderFeed(): string {
  const feed = new Feed({
    title: m.docs_changelog_og_alt(),
    id: `${baseURL}${changelogRoute}`,
    link: `${baseURL}${changelogRoute}`,
    language: "en",
  });

  for (const page of getChangelogPages()) {
    feed.addItem({
      id: page.url,
      title: `ZotLit ${page.data.version}`,
      description: page.data.description,
      link: `${baseURL}${page.url}`,
      date: new Date(`${page.data.date}T00:00:00Z`),
    });
  }

  return feed.rss2();
}

export const Route = createFileRoute("/changelog/rss.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(renderFeed(), {
          headers: { "content-type": "application/rss+xml; charset=utf-8" },
        }),
    },
  },
});
