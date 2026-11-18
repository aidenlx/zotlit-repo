import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/landing-page.tsx";
import { SiteFooter } from "@/components/site-footer.tsx";
import { appDescription, HOME_OG_ALT, pageHead } from "@/lib/seo.ts";
import {
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/structured-data.ts";
import { m } from "@/paraglide/messages.js";

export const Route = createFileRoute("/_home/")({
  component: Home,
  head: () =>
    pageHead({
      fullTitle: m.docs_home_document_title(),
      description: appDescription(),
      path: "/",
      card: { type: "home", alt: HOME_OG_ALT() },
      schemas: [websiteSchema, organizationSchema, softwareApplicationSchema],
    }),
});

function Home() {
  return <LandingPage footer={<SiteFooter />} />;
}
