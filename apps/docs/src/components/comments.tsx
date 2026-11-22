import Giscus from "@giscus/react";
import { useTheme } from "fumadocs-ui/provider/base";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn.ts";
import { repoSlug } from "@/lib/shared.ts";
import { getLocale } from "@/paraglide/runtime.js";

export function Comments({
  term,
  className,
}: {
  term: string;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [origin, setOrigin] = useState<string>();

  useEffect(() => setOrigin(window.location.origin), []);

  if (!origin) return null;

  return (
    <section className={cn("font-sans", className)}>
      <Giscus
        repo={repoSlug}
        repoId="R_kgDOGy2_uA"
        category="Docs Comments"
        categoryId="DIC_kwDOGy2_uM4DBbqz"
        mapping="specific"
        term={term}
        strict="1"
        reactionsEnabled="1"
        emitMetadata="0"
        inputPosition="top"
        theme={`${origin}/giscus/${resolvedTheme === "dark" ? "dark" : "light"}.css`}
        lang={getLocale()}
        loading="lazy"
        host="https://giscus.app"
      />
    </section>
  );
}
