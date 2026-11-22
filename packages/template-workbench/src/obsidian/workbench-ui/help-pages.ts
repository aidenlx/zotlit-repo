interface HelpPage {
  readonly label: () => string;
  readonly path: string;
}

export const HELP_PAGES: readonly HelpPage[] = [
  { label: m.workbench_docs_guide, path: "/docs/how-to/customize-a-template" },
  { label: m.workbench_docs_note, path: "/docs/reference/templates/syntax" },
  { label: m.workbench_docs_data, path: "/docs/reference/templates/data" },
];
import * as m from "@zotlit/plugin-messages/messages.ts";
