import { Outlet, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { DocsSubnav } from "@/components/docs-subnav.tsx";
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/layouts/docs/slots/sidebar.tsx";
import { validateSiteLocale } from "@/lib/i18n.ts";
import { baseOptions } from "@/lib/layout.shared.tsx";
import { source } from "@/lib/source.ts";
import { getLocale } from "@/paraglide/runtime.js";

const getPageTree = createServerFn({ method: "GET" })
  .validator(validateSiteLocale)
  .handler(({ data: locale }) => source.getPageTree(locale) as object);

export const Route = createFileRoute("/docs")({
  component: DocsShell,
  loader: () => getPageTree({ data: getLocale() }),
});

function DocsShell() {
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- the loader type is `object` to tsc; the cast narrows it to the page tree
  const tree = Route.useLoaderData() as Root;

  return (
    <DocsLayout
      tree={tree}
      {...baseOptions({ includeDocsLink: false })}
      sidebar={{ defaultOpenLevel: 0 }}
      slots={{
        header: DocsSubnav,
        sidebar: {
          provider: SidebarProvider,
          root: Sidebar,
          trigger: SidebarTrigger,
          useSidebar,
        },
      }}
    >
      <Outlet />
    </DocsLayout>
  );
}
