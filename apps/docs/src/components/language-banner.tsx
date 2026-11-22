import { useRouterState } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Banner } from "@/components/banner.tsx";
import {
  CHINESE_READER_ATTR,
  rememberLanguageChoice,
} from "@/lib/language-choice.ts";
import type { PageLocaleState } from "@/lib/locale-state.ts";
import * as m from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const browserHash = () => window.location.hash;
const serverHash = () => "";

const STRIP_HEIGHT = "2.25rem";

const SUGGESTION_ATTR = "data-chinese-edition";

export function LanguageBanner({ state }: { state: PageLocaleState }) {
  const location = useRouterState({
    select: (router) => ({
      publicHref: router.location.publicHref,
      hash: router.location.hash,
    }),
  });
  const hash = useSyncExternalStore(subscribeToHash, browserHash, serverHash);

  const url = new URL(location.publicHref, "https://zotlit.invalid");
  url.hash = hash;

  if (state.isFallback) {
    const englishHref = `${state.canonicalPath}${url.search}${url.hash}`;

    return (
      <Banner
        role="note"
        lang={getLocale()}
        height={STRIP_HEIGHT}
        className={STRIP_CLASS}
      >
        <StripText
          message={m.docs_locale_fallback()}
          href={englishHref}
          action={m.docs_read_in_english()}
        />
      </Banner>
    );
  }

  const chinese = state.alternates.find(
    (alternate) => alternate.locale === "zh-CN",
  );
  if (state.contentLocale !== "en" || !chinese) return null;

  return (
    <Banner
      {...{ [SUGGESTION_ATTR]: "" }}
      role="note"
      lang="zh-CN"
      height={STRIP_HEIGHT}
      changeLayout={false}
      onClose={() => rememberLanguageChoice("en")}
      className={STRIP_CLASS}
    >
      <style>
        {`:root:not([${CHINESE_READER_ATTR}]) [${SUGGESTION_ATTR}] { display: none; }` +
          ` :root[${CHINESE_READER_ATTR}] { --fd-banner-height: ${STRIP_HEIGHT}; }`}
      </style>
      <StripText
        message={m.docs_chinese_edition_available({}, { locale: "zh-CN" })}
        href={`${chinese.path}${url.search}${url.hash}`}
        action={m.docs_read_in_chinese({}, { locale: "zh-CN" })}
      />
    </Banner>
  );
}

const STRIP_CLASS =
  "not-prose border-b border-fd-border/70 bg-fd-secondary py-2 text-fd-secondary-foreground";

function StripText({
  message,
  href,
  action,
}: {
  message: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-1.5 px-7 text-[0.8125rem] leading-snug tracking-[0.005em]">
      <p className="text-balance">{message}</p>
      <a
        href={href}
        className="font-medium whitespace-nowrap text-fd-primary underline decoration-fd-primary/40 underline-offset-[3px] transition-[text-decoration-color] hover:decoration-fd-primary"
      >
        {action}
        <ArrowRight
          aria-hidden
          className="ms-0.5 inline size-[1.05em] shrink-0 align-[-0.14em]"
        />
      </a>
    </div>
  );
}
