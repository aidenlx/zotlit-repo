import { Outlet, createFileRoute } from "@tanstack/react-router";

import { LearnHeader } from "@/components/learn/learn-header.tsx";
import { RedirectNotice } from "@/components/redirect-notice.tsx";

export const Route = createFileRoute("/learn")({
  component: LearnShell,
});

function LearnShell() {
  return (
    <>
      <LearnHeader />
      <div className="mx-auto w-full max-w-[720px] px-5 empty:hidden">
        <RedirectNotice className="mt-5" />
      </div>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </>
  );
}
