import { useHydrated, useLocation } from "@tanstack/react-router";
import { ArrowUpRight, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn.ts";
import { legacyArrival } from "@/lib/legacy-arrival.ts";
import { zotlitLegacyUrl } from "@/lib/shared.ts";
import * as m from "@/paraglide/messages.js";

export function RedirectNotice({ className }: { className?: string }) {
  const hydrated = useHydrated();
  const location = useLocation();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const arrival = hydrated ? legacyArrival(location, dismissed) : null;

  if (!arrival) return null;
  const { key, isZh, v1Src } = arrival;

  return (
    <div
      className={cn(
        "not-prose relative flex flex-col gap-2 border border-fd-border bg-fd-card",
        "px-4 py-3 pe-10 text-[0.9rem] leading-snug text-fd-foreground",
        className,
      )}
    >
      <p className="text-fd-muted-foreground">{m.docs_redirect_v1_notice()}</p>
      <a
        href={`${zotlitLegacyUrl}${isZh ? "/zh-CN" : ""}${v1Src}`}
        target="_blank"
        rel="noreferrer noopener"
        lang={isZh ? "zh-CN" : undefined}
        className={cn(
          "inline-flex w-fit items-center gap-1 font-medium text-fd-primary",
          "underline decoration-fd-primary/40 underline-offset-[3px]",
          "transition-[text-decoration-color] hover:decoration-fd-primary",
        )}
      >
        {isZh
          ? m.docs_redirect_original_page({}, { locale: "zh-CN" })
          : m.docs_redirect_original_page()}
        <ArrowUpRight aria-hidden className="size-[1.05em]" />
      </a>
      <button
        type="button"
        aria-label={m.docs_dismiss_notice(
          {},
          isZh ? { locale: "zh-CN" } : undefined,
        )}
        onClick={() => setDismissed(key)}
        className="absolute inset-e-2 top-2 text-fd-muted-foreground/60 hover:text-fd-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
