export function inlineCitation(rendered: string): string {
  return rendered.replaceAll(/\s*\n\s*/g, " ").trim();
}
