import gelasioLatinItalic from "@fontsource-variable/gelasio/files/gelasio-latin-wght-italic.woff2?url";
import gelasioLatin from "@fontsource-variable/gelasio/files/gelasio-latin-wght-normal.woff2?url";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { LanguageBanner } from "@/components/language-banner.tsx";
import { LocaleProvider } from "@/components/locale-provider.tsx";
import { Message } from "@/components/message.tsx";
import { Toaster } from "@/components/ui/toast.tsx";
import zhCnFontsCss from "@/fonts-zh-cn.css?url";
import { Header } from "@/layouts/home/slots/header.tsx";
import { chineseReaderScript } from "@/lib/language-choice.ts";
import { baseOptions } from "@/lib/layout.shared.tsx";
import { getPageLocaleState } from "@/lib/locale-state.ts";
import { appDescription, HOME_OG_ALT, ogImageMeta } from "@/lib/seo.ts";
import { appName, baseURL } from "@/lib/shared.ts";
import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import appCss from "@/styles.css?url";

const analyticsToken: string | undefined = import.meta.env.VITE_CF_BEACON_TOKEN;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: appName },
      { name: "application-name", content: appName },
      { name: "description", content: appDescription() },
      { property: "og:site_name", content: appName },
      { property: "og:locale", content: "en_US" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: baseURL },
      { property: "og:title", content: appName },
      { property: "og:description", content: appDescription() },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: appName },
      { name: "twitter:description", content: appDescription() },
      ...ogImageMeta("home", HOME_OG_ALT()),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      ...[gelasioLatin, gelasioLatinItalic].map((href) => ({
        rel: "preload",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
        href,
      })),
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const localeState = getPageLocaleState(pathname, getLocale());
  return (
    <html lang={localeState.contentLocale} suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: chineseReaderScript }} />
        {localeState.contentLocale === "zh-CN" && (
          <link rel="stylesheet" href={zhCnFontsCss} />
        )}
      </head>
      <body className="flex min-h-screen flex-col">
        <LocaleProvider>
          <LanguageBanner state={localeState} />
          {children}
          <Toaster />
        </LocaleProvider>
        {analyticsToken && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: analyticsToken })}
          />
        )}
        <TanStackDevtools
          config={{ position: "bottom-left" }}
          plugins={[
            {
              name: "TanStack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <HomeLayout {...baseOptions()} slots={{ header: Header }}>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-16">
        <h1 className="mb-2 text-3xl font-medium">
          {m.docs_not_found_title()}
        </h1>
        <p className="text-fd-muted-foreground">
          <Message
            text={m.docs_not_found_description({ link: "{link}" })}
            slots={{
              link: (
                <a
                  href={localizeHref("/docs")}
                  className="text-fd-primary underline"
                >
                  {m.docs_not_found_docs()}
                </a>
              ),
            }}
          />
        </p>
      </main>
    </HomeLayout>
  );
}
