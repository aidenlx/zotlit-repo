export function internalLink(linktext: string, alias?: string): string {
  const breadcrumb = linktext
    .split("#")
    .filter((segment) => segment !== "")
    .join(" > ");
  const aliasAttrs =
    alias === undefined
      ? ""
      : ` aria-label="${breadcrumb}" data-tooltip-position="top"`;
  return (
    `<a data-href="${linktext}" href="${linktext}" class="internal-link"${aliasAttrs}>` +
    `${alias ?? breadcrumb}</a>`
  );
}

export function section(html: string): HTMLElement {
  const root = document.createElement("div");
  // eslint-disable-next-line no-unsanitized/property -- fixture HTML written in the test
  root.innerHTML = html;
  return root;
}
