import { usePathname } from "fumadocs-core/framework";
import type { FooterProps } from "fumadocs-ui/layouts/docs/page/slots/footer";

import { Comments } from "@/components/comments.tsx";
import { Footer } from "@/layouts/docs/page/slots/footer.tsx";
import { unlocalizedPath } from "@/lib/i18n.ts";

export function DocsPageFooter(props: FooterProps) {
  const pathname = usePathname();

  return (
    <Footer {...props}>
      <Comments
        term={unlocalizedPath(pathname).replace(/^\//, "")}
        className="mt-6"
      />
    </Footer>
  );
}
