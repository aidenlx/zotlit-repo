import {
  Link,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { Framework } from "fumadocs-core/framework";
import { FrameworkProvider } from "fumadocs-core/framework";
import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/base";
import type { ReactNode } from "react";
import { useMemo, useRef } from "react";

import { DocsImage } from "@/components/docs-image.tsx";
import { fumadocsTranslations } from "@/lib/fumadocs-translations.ts";
import { i18n } from "@/lib/i18n.ts";
import { rememberLanguageChoice } from "@/lib/language-choice.ts";
import {
  deLocalizeHref,
  getLocale,
  isLocale,
  setLocale,
} from "@/paraglide/runtime.js";

const framework: Framework = {
  Link({ href = "#", prefetch = true, ...props }) {
    return (
      <Link
        to={
          href.startsWith("/") && !href.startsWith("//")
            ? deLocalizeHref(href)
            : href
        }
        preload={prefetch ? "intent" : false}
        {...props}
      />
    );
  },
  Image: DocsImage,
  usePathname() {
    const { isLoading, publicHref } = useRouterState({
      select: (state) => ({
        isLoading: state.isLoading,
        publicHref: state.location.publicHref,
      }),
    });
    const pathname = new URL(publicHref, "https://zotlit.invalid").pathname;
    const activePathname = useRef(pathname);
    return useMemo(() => {
      if (isLoading) return activePathname.current;
      activePathname.current = pathname;
      return pathname;
    }, [isLoading, pathname]);
  },
  useRouter() {
    const router = useRouter();
    return useMemo(
      () => ({
        push(url: string) {
          void router.navigate({ href: url });
        },
        refresh() {
          void router.invalidate();
        },
      }),
      [router],
    );
  },
  useParams() {
    return useParams({ strict: false });
  },
};

export function LocaleProvider({ children }: { children: ReactNode }) {
  const translations = i18n
    .translations()
    .extend(uiTranslations())
    .add({
      en: fumadocsTranslations("en"),
      "zh-CN": fumadocsTranslations("zh-CN"),
    });
  return (
    <FrameworkProvider {...framework}>
      <RootProvider
        i18n={{
          ...i18nProvider(translations, getLocale()),
          onLocaleChange(locale) {
            if (!isLocale(locale)) return;
            rememberLanguageChoice(locale);
            void setLocale(locale);
          },
        }}
      >
        {children}
      </RootProvider>
    </FrameworkProvider>
  );
}
