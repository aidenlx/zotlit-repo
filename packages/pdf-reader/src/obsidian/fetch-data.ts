export async function obsidianFetchData(
  kind: "cmap" | "standard-font",
  filename: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const folder = kind === "cmap" ? "cmaps" : "standard_fonts";
  const response = await fetch(`/lib/pdfjs/${folder}/${filename}`, { signal });
  if (!response.ok) {
    throw new Error(
      `Obsidian has no PDF.js ${kind} file ${filename} (HTTP ${response.status})`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
