import { regex } from "arkregex";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { build } from "vite";

const packageRoot = resolve(import.meta.dirname, "..");
const output = join(packageRoot, "src/generated");
const require = createRequire(join(packageRoot, "package.json"));
const workerEntry = require.resolve("@zotlit/pdfjs/worker");
const entryId = join(import.meta.dirname, "pdfjs-worker-entry.js");

const FORBIDDEN = regex(
  `\\brequire\\(\\s*["'](?<module>obsidian|electron)["']\\s*\\)|(?<script>document\\.currentScript)`,
);

async function workerSource(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    plugins: [
      {
        name: "pdfjs-worker-entry",
        resolveId: (id) => (id === entryId ? id : null),
        load: (id) =>
          id === entryId ? `import ${JSON.stringify(workerEntry)};` : null,
      },
    ],
    build: {
      write: false,
      reportCompressedSize: false,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      target: "esnext",
      lib: { entry: entryId, formats: ["iife"], name: "zprPdfjsWorker" },
      rolldownOptions: {
        transform: { define: { "import.meta": "{}" } },
        output: { codeSplitting: false },
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((item) => ("output" in item ? item.output : []))
    .find((item) => item.type === "chunk");
  if (!chunk) throw new Error("The PDF.js worker build emitted no chunk");
  const forbidden = FORBIDDEN.exec(chunk.code);
  if (forbidden) {
    throw new Error(
      `The PDF.js worker bundle contains ${forbidden.groups.module ? `require("${forbidden.groups.module}")` : forbidden.groups.script}, which a classic blob worker cannot run`,
    );
  }
  return chunk.code;
}

async function wasmBase64(name: string): Promise<string> {
  const bytes = await readFile(
    require.resolve(`@zotlit/pdfjs/wasm/${name}.wasm`),
  );
  return bytes.toString("base64");
}

async function annotationIcons(): Promise<Record<string, string>> {
  const folder = join(
    dirname(require.resolve("@zotlit/pdfjs/package.json")),
    "dist/images",
  );
  const icons: Record<string, string> = {};
  for (const name of (await readdir(folder)).toSorted()) {
    if (!name.startsWith("annotation-") || !name.endsWith(".svg")) continue;
    const bytes = await readFile(join(folder, name));
    icons[name] = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
  }
  return icons;
}

await mkdir(output, { recursive: true });
await writeFile(
  join(output, "worker-source.ts"),
  `export default ${JSON.stringify(await workerSource())};\n`,
);
await writeFile(
  join(output, "wasm.ts"),
  `export const jbig2 = ${JSON.stringify(await wasmBase64("jbig2"))};\nexport const openjpeg = ${JSON.stringify(await wasmBase64("openjpeg"))};\n`,
);
await writeFile(
  join(output, "images.ts"),
  `export const annotationIcons: Readonly<Record<string, string>> = ${JSON.stringify(await annotationIcons(), null, 2)};\n`,
);
