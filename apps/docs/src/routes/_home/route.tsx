import { Outlet, createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { RedirectNotice } from "@/components/redirect-notice.tsx";
import { Header } from "@/layouts/home/slots/header.tsx";
import { baseOptions } from "@/lib/layout.shared.tsx";

export const Route = createFileRoute("/_home")({
  component: HomeShell,
});

function HomeShell() {
  return (
    <HomeLayout {...baseOptions()} slots={{ header: Header }}>
      <div className="mx-auto w-full max-w-3xl px-6">
        <RedirectNotice className="mt-6" />
      </div>
      <Outlet />
    </HomeLayout>
  );
}
