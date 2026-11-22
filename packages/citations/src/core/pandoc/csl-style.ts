import { regex } from "arkregex";

export interface InstalledCslStyle {
  id: string;
  title: string;
}

export interface StyleFile extends InstalledCslStyle {
  path: string;
  parentId: string | undefined;
  defaultLocale: string | undefined;
}

export interface CslStyleRequest {
  styleId: string | null;
  locale?: string | null;
}

export type CslStyleFailure =
  | "style-missing"
  | "parent-missing"
  | "unreadable"
  | "invalid";

export type ResolvedCslStyle =
  | {
      kind: "default";
      locale: string | undefined;
    }
  | {
      kind: "installed";
      styleId: string;
      parentId: string | undefined;
      title: string;
      xml: string;
    }
  | {
      kind: "failed";
      styleId: string;
      parentId: string | undefined;
      reason: CslStyleFailure;
    };

export function selectableStyles(
  visibleFiles: readonly StyleFile[],
  hiddenFiles: readonly StyleFile[],
): InstalledCslStyle[] {
  const visible = indexById(visibleFiles);
  const all = indexById([...visible.values(), ...hiddenFiles]);
  return [...visible.values()]
    .filter(({ parentId }) => parentId === undefined || all.has(parentId))
    .map(({ id, title }) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function styleHasEntryMarkers(styleXml: string | undefined): boolean {
  return (
    styleXml !== undefined && BIBLIOGRAPHY_WITH_ENTRY_MARKERS.test(styleXml)
  );
}

export function indexById(files: readonly StyleFile[]): Map<string, StyleFile> {
  const styles = new Map<string, StyleFile>();
  for (const file of files) {
    if (!styles.has(file.id)) styles.set(file.id, file);
  }
  return styles;
}

export function styleFileOf(path: string, xml: string): StyleFile | undefined {
  const info = INFO_BLOCK.exec(xml)?.groups.info;
  const id = info && ID.exec(info)?.groups.id.trim();
  if (!info || !id) {
    return undefined;
  }
  const styleId = decodeXmlText(id);
  const title = TITLE.exec(info)?.groups.title.trim();
  return {
    id: styleId,
    title: title ? decodeXmlText(title) : styleId,
    path,
    parentId: parentIdOf(info),
    defaultLocale: defaultLocaleOf(xml),
  };
}

const PREFIX = "(?:[^\\s/<>=:]+:)?";
const INFO_BLOCK = regex(
  `<${PREFIX}info(?=[\\s>])[^>]*>(?<info>[\\s\\S]*?)</${PREFIX}info\\s*>`,
);
const ID = regex(`<${PREFIX}id(?=[\\s>])[^>]*>(?<id>[^<]*)</${PREFIX}id\\s*>`);
const TITLE = regex(
  `<${PREFIX}title(?=[\\s>])[^>]*>(?<title>[^<]*)</${PREFIX}title\\s*>`,
);
const BIBLIOGRAPHY_WITH_ENTRY_MARKERS = regex(
  `<${PREFIX}bibliography(?=[\\s/>])[^>]*\\bsecond-field-align\\s*=`,
);
const LINK_TAG = regex(`<${PREFIX}link(?=[\\s/>])[^>]*>`, "g");
const HREF = regex("href\\s*=\\s*[\"'](?<href>[^\"']*)[\"']");
const REL = regex("rel\\s*=\\s*[\"'](?<rel>[^\"']*)[\"']");
const STYLE_ROOT = regex(`<(?<name>${PREFIX}style)(?=[\\s/>])[^>]*>`);
const STYLE_ELEMENT = "style";
const RENDERING_ELEMENTS = new Set(["citation", "bibliography"]);
const LAYOUT_ELEMENT = "layout";
const PARSER_ERROR = "parsererror";
const DEFAULT_LOCALE = regex(
  "default-locale\\s*=\\s*[\"'](?<locale>[^\"']*)[\"']",
);
const DEFAULT_LOCALE_ATTR = /\s*default-locale\s*=\s*["'][^"']*["']/;

export function cslStyleRoot(xml: string): Element | null {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  if (parsed.getElementsByTagName(PARSER_ERROR).length > 0) return null;
  const root = parsed.documentElement;
  return root.localName === STYLE_ELEMENT ? root : null;
}

export function isStandaloneCslStyle(xml: string): boolean {
  const root = cslStyleRoot(xml);
  return (
    root !== null &&
    [...root.children].some(
      (child) =>
        RENDERING_ELEMENTS.has(child.localName) &&
        [...child.children].some(
          (grandchild) => grandchild.localName === LAYOUT_ELEMENT,
        ),
    )
  );
}

function parentIdOf(info: string): string | undefined {
  for (const tag of info.match(LINK_TAG) ?? []) {
    if (REL.exec(tag)?.groups.rel === "independent-parent") {
      const href = HREF.exec(tag)?.groups.href;
      return href === undefined ? undefined : decodeXmlText(href);
    }
  }
  return undefined;
}

export function defaultLocaleOf(xml: string): string | undefined {
  const root = STYLE_ROOT.exec(xml)?.[0];
  const locale = root && DEFAULT_LOCALE.exec(root)?.groups.locale.trim();
  return locale ? decodeXmlText(locale) : undefined;
}

export function withDefaultLocale(
  xml: string,
  locale: string | undefined,
): string {
  if (locale === undefined) return xml;
  const root = STYLE_ROOT.exec(xml);
  if (!root) return xml;

  const tag = root[0];
  const { name } = root.groups;
  const selfClosing = tag.endsWith("/>");
  const attributes = tag
    .slice(`<${name}`.length, selfClosing ? -2 : -1)
    .replace(DEFAULT_LOCALE_ATTR, "")
    .trimEnd();
  const replacement = `<${name}${attributes} default-locale="${encodeXmlText(locale)}"${
    selfClosing ? "/>" : ">"
  }`;
  return (
    xml.slice(0, root.index) + replacement + xml.slice(root.index + tag.length)
  );
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXmlText(text: string): string {
  return text.replaceAll(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) => XML_ENTITIES[entity] ?? entity,
  );
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function encodeXmlText(text: string): string {
  return text.replaceAll(/[&<>"]/g, (char) => XML_ESCAPES[char] ?? char);
}
