import { Outlet, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
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
import { renderSidebarTree, sidebarTreeData } from "@/lib/sidebar-tree.ts";
import { source } from "@/lib/source.ts";
import { getLocale } from "@/paraglide/runtime.js";

const getPageTree = createServerFn({ method: "GET" })
  .validator(validateSiteLocale)
  .handler(({ data: locale }) => sidebarTreeData(source.getPageTree(locale)));

export const Route = createFileRoute("/docs")({
  component: DocsShell,
  loader: () => getPageTree({ data: getLocale() }),
});

function DocsShell() {
  const tree = renderSidebarTree(Route.useLoaderData());

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
