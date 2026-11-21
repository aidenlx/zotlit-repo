// What the Workbench view's Help action opens: the docs pages
// a template author returns to, then the community for what they miss. Each
// path is on the docs site; a host joins it to the site it links to. The
// community link is the host's own `communityUrl`, which the Problems area
// offers too.

interface HelpPage {
  readonly label: () => string;
  readonly path: string;
}

/** The step-by-step guide, the syntax, and the field reference. */
export const HELP_PAGES: readonly HelpPage[] = [
  { label: m.workbench_docs_guide, path: "/docs/how-to/customize-a-template" },
  { label: m.workbench_docs_note, path: "/docs/reference/templates/syntax" },
  { label: m.workbench_docs_data, path: "/docs/reference/templates/data" },
];
import * as m from "@zotlit/plugin-messages/messages.ts";
