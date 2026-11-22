export function plainMdxText(text: string, source: string): string {
  const opener = /[{}<]/.exec(text.replaceAll(/`[^`]*`/g, ""));
  if (opener) {
    throw new Error(
      `${source} carries the MDX opener ${opener[0]} outside a code span: ${text}`,
    );
  }
  return text;
}
