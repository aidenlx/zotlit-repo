import type { PdfReader, ReaderPage } from "#/core/index.ts";

import { lightness } from "#/core/theme/theme.ts";
import { testHost } from "#test/host.ts";
import {
  fixtureSource,
  installStyles,
  mountFixture,
  pause,
  stateWhere,
  testEngine,
  within,
} from "#test/reader.ts";

type Rgb = readonly [number, number, number];

export interface ThemeSample {
  readonly themed: boolean;
  readonly inverted: boolean;
  readonly background: Rgb;
  readonly ink: Rgb;
  readonly rect: Rgb;
  readonly image: Rgb;
  readonly fieldFilter: string;
  readonly thumbnail: Rgb;
  readonly popupBackground: string;
}

export interface ThemeReport {
  readonly plain: ThemeSample;
  readonly dark: ThemeSample;
  readonly light: ThemeSample;
  readonly unchanged: { readonly repainted: boolean };
  readonly off: ThemeSample;
}

const DARK = "#1e1e1e";
const SEPIA = "#f4ecd8";
const POPUP = "#262626";

function pageCanvas(page: ReaderPage): HTMLCanvasElement {
  const canvas = page.div.querySelector<HTMLCanvasElement>(
    ".canvasWrapper canvas",
  );
  if (!canvas) throw new Error("The page has no canvas");
  return canvas;
}

function at(
  canvas: HTMLCanvasElement,
  page: ReaderPage,
  [x, y]: readonly [number, number],
): readonly [number, number] {
  const [vx = 0, vy = 0] = page.viewport.convertToViewportPoint(x, y);
  return [
    Math.round((vx * canvas.width) / page.viewport.width),
    Math.round((vy * canvas.height) / page.viewport.height),
  ];
}

function pixel(canvas: HTMLCanvasElement, cx: number, cy: number): Rgb {
  const context = canvas.getContext("2d")!;
  const [r = 0, g = 0, b = 0] = context.getImageData(cx, cy, 1, 1).data;
  return [r, g, b];
}

function inkIn(
  canvas: HTMLCanvasElement,
  page: ReaderPage,
  background: Rgb,
): Rgb {
  const [left, top] = at(canvas, page, [120, 175]);
  const [right, bottom] = at(canvas, page, [180, 112]);
  const context = canvas.getContext("2d")!;
  const { data } = context.getImageData(left, top, right - left, bottom - top);
  let ink: Rgb = background;
  let distance = 0;
  for (let index = 0; index < data.length; index += 4) {
    const rgb: Rgb = [data[index]!, data[index + 1]!, data[index + 2]!];
    const away = Math.abs(lightness(rgb) - lightness(background));
    if (away > distance) {
      distance = away;
      ink = rgb;
    }
  }
  return ink;
}

function thumbnailCanvas(reader: PdfReader): HTMLCanvasElement | null {
  return reader.root.querySelector<HTMLCanvasElement>(
    "[data-zpr-part='thumbnail'] canvas[data-painted]",
  );
}

function thumbnailCorner(reader: PdfReader): Rgb | null {
  const canvas = thumbnailCanvas(reader);
  if (!canvas || canvas.width === 0) return null;
  return pixel(
    canvas,
    Math.round(canvas.width * 0.03),
    Math.round(canvas.height * 0.05),
  );
}

async function thumbnailWhere(
  reader: PdfReader,
  accept: (rgb: Rgb) => boolean,
): Promise<Rgb> {
  for (let tries = 0; tries < 100; tries++) {
    const rgb = thumbnailCorner(reader);
    if (rgb && accept(rgb)) return rgb;
    await pause(50);
  }
  throw new Error(
    `The thumbnail did not repaint: ${JSON.stringify(thumbnailCorner(reader))}`,
  );
}

async function fieldOf(page: ReaderPage): Promise<HTMLElement> {
  for (let tries = 0; tries < 100; tries++) {
    const field = page.div.querySelector<HTMLElement>(
      ".annotationLayer .textWidgetAnnotation input",
    );
    if (field) return field;
    await pause(50);
  }
  throw new Error(
    `The page has no text field: ${page.div.querySelector(".annotationLayer")?.outerHTML ?? "no annotation layer"}`,
  );
}

function near(a: Rgb, b: Rgb): boolean {
  return a.every((value, index) => Math.abs(value - b[index]!) <= 2);
}

async function sample(reader: PdfReader, thumbnail: Rgb): Promise<ThemeSample> {
  await within("settled", reader.settled());
  const page = reader.pageAt(0)!;
  const canvas = pageCanvas(page);
  const background = pixel(canvas, ...at(canvas, page, [10, 190]));
  const field = await fieldOf(page);
  return {
    themed: reader.state.get().themed,
    inverted: reader.root.hasAttribute("data-zpr-inverted"),
    background,
    ink: inkIn(canvas, page, background),
    rect: pixel(canvas, ...at(canvas, page, [60, 145])),
    image: pixel(canvas, ...at(canvas, page, [240, 150])),
    fieldFilter: getComputedStyle(field).filter,
    thumbnail: await thumbnailWhere(reader, (rgb) => near(rgb, thumbnail)),
    popupBackground: getComputedStyle(reader.root)
      .getPropertyValue("--zpr-popup-background")
      .trim(),
  };
}

export async function run(): Promise<ThemeReport> {
  installStyles();
  using engine = testEngine();
  const themeListeners = new Set<() => void>();
  const host = Object.assign(testHost("theme.pdf"), {
    watchTheme: (onChange: () => void) => {
      themeListeners.add(onChange);
      return () => {
        themeListeners.delete(onChange);
      };
    },
  });
  const cssChange = () => {
    for (const listener of themeListeners) listener();
  };
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/theme.pdf"),
    host,
  });
  const { reader, element } = mounted;
  element.style.setProperty("--background-primary", DARK);
  element.style.setProperty("--background-secondary-alt", POPUP);
  await within("ready", reader.whenReady());
  reader.set({ sidebar: { open: true, panel: "thumbnails" } });
  const plain = await sample(reader, [255, 255, 255]);

  reader.set({ themed: true });
  await within(
    "themed",
    stateWhere(reader, ({ themed }) => themed),
  );
  const dark = await sample(reader, [30, 30, 30]);

  element.style.setProperty("--pdf-page-background", SEPIA);
  cssChange();
  const light = await sample(reader, [244, 236, 216]);

  let repainted = false;
  const off = reader.on("page-rendered", () => {
    repainted = true;
  });
  cssChange();
  await within("settled", reader.settled());
  off();

  reader.set({ themed: false });
  const plainAgain = await sample(reader, [255, 255, 255]);

  return {
    plain,
    dark,
    light,
    unchanged: { repainted },
    off: plainAgain,
  };
}
