type LinkHelper = ((alias?: string, subpath?: string) => string) & {
  renderEmbed?: (alias?: string, subpath?: string) => string;
};

export function embed(
  link: LinkHelper | null | undefined,
  alias?: string,
  subpath?: string,
): string {
  if (!link) return "";
  if (link.renderEmbed) return link.renderEmbed(alias, subpath);
  const rendered = link(alias, subpath);
  return rendered ? `!${rendered}` : "";
}
