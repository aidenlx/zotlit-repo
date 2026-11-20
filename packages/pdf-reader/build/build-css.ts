import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { Features, transform } from "lightningcss";
import type { Selector, SelectorComponent } from "lightningcss";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const require = createRequire(join(packageRoot, "package.json"));
const stylesDir = join(packageRoot, "src/core/styles");
const pdfjsDist = join(
  dirname(require.resolve("@zotlit/pdfjs/package.json")),
  "dist",
);
const target = resolve(packageRoot, process.argv[2] ?? "src/generated/styles.css");

const ROOT: SelectorComponent = { type: "class", name: "zpr-root" };
const DESCENDANT: SelectorComponent = {
  type: "combinator",
  value: "descendant",
};

function scoped(selector: Selector): Selector {
  const [first, ...rest] = selector;
  if (first?.type === "pseudo-class" && first.kind === "root") {
    return [ROOT, ...rest];
  }
  if (first?.type === "type" && (first.name === "html" || first.name === "body")) {
    return [ROOT, ...rest];
  }
  return [ROOT, DESCENDANT, ...selector];
}

async function tailwindLayers(): Promise<string> {
  const source = await readFile(join(stylesDir, "index.css"), "utf8");
  const compiler = await compile(source, {
    base: stylesDir,
    onDependency: () => {},
  });
  const scanner = new Scanner({
    sources: [
      {
        base: join(packageRoot, "src/core"),
        pattern: "**/*.{ts,tsx}",
        negated: false,
      },
    ],
  });
  return compiler.build(scanner.scan());
}

async function scopedViewerCss(): Promise<string> {
  const filename = join(pdfjsDist, "pdf_viewer.css");
  const code = await readFile(filename);
  const flat = transform({
    filename,
    code,
    include: Features.Nesting,
  }).code;
  return transform({
    filename,
    code: flat,
    visitor: {
      Selector: scoped,
      Url(url) {
        if (!url.url.startsWith("images/")) return url;
        const bytes = readFileSync(join(pdfjsDist, url.url));
        return {
          ...url,
          url: `data:image/svg+xml;base64,${bytes.toString("base64")}`,
        };
      },
    },
  }).code.toString();
}

const parts = [
  await tailwindLayers(),
  await scopedViewerCss(),
  await readFile(join(stylesDir, "viewer.css"), "utf8"),
  await readFile(join(stylesDir, "obsidian-reset.css"), "utf8"),
  await readFile(join(packageRoot, "src/obsidian/embed.css"), "utf8"),
];
await mkdir(dirname(target), { recursive: true });
await writeFile(target, parts.join("\n"));
