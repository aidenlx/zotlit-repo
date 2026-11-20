import type { PdfReader } from "#/core/index.ts";

import {
  fixtureSource,
  installStyles,
  mountFixture,
  prependStyles,
  testEngine,
  within,
} from "#test/reader.ts";

const obsidianCss = Object.values(
  import.meta.glob<string>(
    "../../../../../node_modules/.ob-rev-1.15.1/app.css",
    { eager: true, query: "?raw", import: "default" },
  ),
).join("\n");

const TARGETS = {
  textLayer: ".textLayer",
  textSpan: ".textLayer span:not(.markedContent)",
  annotationLayer: ".annotationLayer",
  linkAnnotation: ".annotationLayer .linkAnnotation",
  viewer: ".pdfViewer",
  page: ".page",
  canvasWrapper: ".canvasWrapper",
  button: "[data-zpr-part='zoom-in']",
  thumbnail: "[data-zpr-part='thumbnail']",
} as const;

type Target = keyof typeof TARGETS;

export interface StylesReport {
  readonly available: boolean;
  readonly controlChanged: boolean;
  readonly differences: Readonly<
    Record<Target, Readonly<Record<string, readonly [string, string]>>>
  >;
  readonly spanBox: readonly [string, string];
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function snapshot(element: Element): Record<string, string> {
  const style = getComputedStyle(element);
  const values: Record<string, string> = {};
  for (let index = 0; index < style.length; index++) {
    const name = style.item(index);
    values[name] = style.getPropertyValue(name);
  }
  return values;
}

function capture(reader: PdfReader): Record<Target, Record<string, string>> {
  const page = reader.pageAt(0)!.div;
  return Object.fromEntries(
    Object.entries(TARGETS).map(([name, selector]) => {
      const element =
        name === "viewer" || name === "button" || name === "thumbnail"
          ? reader.root.querySelector(selector)
          : page.matches(selector)
            ? page
            : page.querySelector(selector);
      if (!element) throw new Error(`No ${name} element`);
      return [name, snapshot(element)];
    }),
  ) as Record<Target, Record<string, string>>;
}

function boxOf(reader: PdfReader): string {
  const span = reader.pageAt(0)!.div.querySelector(TARGETS.textSpan)!;
  const box = span.getBoundingClientRect();
  const page = reader.pageAt(0)!.div.getBoundingClientRect();
  return [box.left - page.left, box.top - page.top, box.width, box.height]
    .map((value) => value.toFixed(2))
    .join(",");
}

export async function run(): Promise<StylesReport> {
  installStyles();
  const control = document.createElement("div");
  control.className = "textLayer";
  control.append(document.createElement("span"));
  document.body.append(control);
  const controlBefore = snapshot(control.firstElementChild!);
  using engine = testEngine();
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  reader.set({ sidebar: { open: true, panel: "thumbnails" } });
  const deadline = performance.now() + 10_000;
  while (
    !reader.pageAt(0)?.div.querySelector(TARGETS.linkAnnotation) ||
    !reader.root.querySelector(TARGETS.thumbnail)
  ) {
    if (performance.now() > deadline) throw new Error("No link annotation");
    await frame();
  }
  await frame();
  await within("settled with the sidebar", reader.settled());
  const before = capture(reader);
  const boxBefore = boxOf(reader);
  if (!obsidianCss) {
    return {
      available: false,
      controlChanged: false,
      differences: {} as StylesReport["differences"],
      spanBox: [boxBefore, boxBefore],
    };
  }
  prependStyles(obsidianCss);
  document.body.classList.add("theme-light");
  await frame();
  await frame();
  const after = capture(reader);
  const controlAfter = snapshot(control.firstElementChild!);
  const differences = Object.fromEntries(
    (Object.keys(TARGETS) as Target[]).map((name) => [
      name,
      Object.fromEntries(
        Object.entries(after[name])
          .filter(
            ([property, value]) =>
              !property.startsWith("--") && before[name][property] !== value,
          )
          .map(([property, value]) => [
            property,
            [
              (before[name][property] ?? "").slice(0, 60),
              value.slice(0, 60),
            ] as const,
          ]),
      ),
    ]),
  ) as StylesReport["differences"];
  return {
    available: true,
    controlChanged: Object.entries(controlAfter).some(
      ([property, value]) => controlBefore[property] !== value,
    ),
    differences,
    spanBox: [boxBefore, boxOf(reader)],
  };
}
