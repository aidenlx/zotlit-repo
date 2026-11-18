// What one CSL style document declares, read from its text: the style it is,
// its independent parent and default locale, whether it renders on its own,
// and the selections the Citation and References Style picker lists.

import { regex } from "arkregex";

/** One installed style, as the Citation and References Style picker lists it. */
export interface InstalledCslStyle {
  /** `<info><id>` — the identity the Citation and References Style setting stores. */
  id: string;
  /** `<info><title>`, or the filename stem when the style declares none. */
  title: string;
}

/** One installed CSL file, as discovery reads it. */
export interface StyleFile extends InstalledCslStyle {
  path: string;
  /** Style ID of the independent parent, when this is a dependent style. */
  parentId: string | undefined;
  /**
   * The `default-locale` this style declares. A dependent style carries its own,
   * which is the one thing it may say that its independent parent does not.
   */
  defaultLocale: string | undefined;
}

/** The style and Citation Locale one render asks the resolver for. */
export interface CslStyleRequest {
  /**
   * Installed CSL ID to render with, or `null` for the engine's embedded
   * default style.
   */
  styleId: string | null;
  /**
   * Citation Locale to render in. It overrides the resolved style's own default
   * locale; `null` or omitted leaves the style's locale in charge.
   */
  locale?: string | null;
}

/**
 * Why one requested style produced no Resolved CSL Style. Each arm names a
 * different repair: install the style, install its parent, restore access to
 * the file, or replace its content.
 */
export type CslStyleFailure =
  /** Zotero has no installed style carrying the requested CSL ID. */
  | "style-missing"
  /** The requested style is dependent, and its independent parent is not installed. */
  | "parent-missing"
  /** A CSL file the requested style is read from refuses to be read. */
  | "unreadable"
  /** The content behind the requested style is not a standalone CSL style. */
  | "invalid";

/**
 * The Resolved CSL Style of one request, keeping Default, an installed style,
 * and each way a selection fails distinct.
 */
export type ResolvedCslStyle =
  | {
      kind: "default";
      /**
       * Citation Locale the request named, which the embedded default style
       * renders in; `undefined` leaves that style's own locale in charge.
       */
      locale: string | undefined;
    }
  | {
      kind: "installed";
      /** The CSL ID that was requested, whichever file the content came from. */
      styleId: string;
      /** CSL ID of the independent parent, when the requested style is dependent. */
      parentId: string | undefined;
      /** The requested style's title, as the style picker lists it. */
      title: string;
      /**
       * Standalone CSL: the independent style's formatting under the effective
       * Citation Locale.
       */
      xml: string;
    }
  | {
      kind: "failed";
      /** The CSL ID that was requested. */
      styleId: string;
      /**
       * CSL ID of the independent parent the requested style names, as far as
       * the failure knows it. It keeps the provenance a diagnostic reports.
       */
      parentId: string | undefined;
      reason: CslStyleFailure;
    };

/**
 * The styles a user can select from the files of the styles folder and its
 * hidden folder, sorted by title. Hidden styles stay out of the list: Zotero
 * keeps them as independent parents of dependent styles, not as choices of
 * their own.
 */
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

/**
 * CSL processors create a left-margin field when `second-field-align` is set;
 * the citation engine exposes that field as the Entry Marker.
 */
export function styleHasEntryMarkers(styleXml: string | undefined): boolean {
  return (
    styleXml !== undefined && BIBLIOGRAPHY_WITH_ENTRY_MARKERS.test(styleXml)
  );
}

/** First file wins, so a visible style shadows a hidden one with the same ID. */
export function indexById(files: readonly StyleFile[]): Map<string, StyleFile> {
  const styles = new Map<string, StyleFile>();
  for (const file of files) {
    if (!styles.has(file.id)) styles.set(file.id, file);
  }
  return styles;
}

/** The style a CSL file declares; `undefined` for one that declares no style ID. */
export function styleFileOf(path: string, xml: string): StyleFile | undefined {
  const info = INFO_BLOCK.exec(xml)?.groups.info;
  const id = info && ID.exec(info)?.groups.id.trim();
  if (!info || !id) {
    return undefined;
  }
  const styleId = decodeXmlText(id);
  const title = TITLE.exec(info)?.groups.title.trim();
  // A style with no title lists under its own ID; a file name would put a path
  // fragment of the user's machine in front of them.
  return {
    id: styleId,
    title: title ? decodeXmlText(title) : styleId,
    path,
    parentId: parentIdOf(info),
    defaultLocale: defaultLocaleOf(xml),
  };
}

/**
 * The namespace prefix an element may be written under. CSL declares one
 * namespace, and a document is free to bind it to a prefix — `<cs:style>` says
 * what `<style>` says — so every element is read whichever way it is spelled.
 *
 * @see https://www.w3.org/TR/2009/REC-xml-names-20091208/#ns-qualnames — the `QName` production
 */
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
/**
 * XML writes an attribute value in either quote, and spaces around the `=` as
 * it likes, so a style Zotero installed is read the way a parser reads it. A
 * value carries neither quote character: the one it is written in would close
 * it, and the other is `&quot;` or `&apos;` there.
 */
const HREF = regex("href\\s*=\\s*[\"'](?<href>[^\"']*)[\"']");
const REL = regex("rel\\s*=\\s*[\"'](?<rel>[^\"']*)[\"']");
/**
 * The root element every standalone CSL style opens with, under the prefix it
 * is written with. The lookahead keeps `<style-options>`, which a locale block
 * carries, out of the match; the element name travels with the match, so the
 * tag can be written back as the document spells it.
 */
const STYLE_ROOT = regex(`<(?<name>${PREFIX}style)(?=[\\s/>])[^>]*>`);
/** The root element name of every CSL style, whichever prefix it carries. */
const STYLE_ELEMENT = "style";
/** The elements a processor formats with; a standalone style declares one. */
const RENDERING_ELEMENTS = new Set(["citation", "bibliography"]);
/**
 * What a rendering element formats through. CSL requires one of these in every
 * `cs:citation` and `cs:bibliography`, and a processor has nothing to render
 * with without it.
 *
 * @see https://docs.citationstyles.org/en/v1.0.2/specification.html#layout
 */
const LAYOUT_ELEMENT = "layout";
/** How an XML parser reports content it cannot read: as an element of its own. */
const PARSER_ERROR = "parsererror";
const DEFAULT_LOCALE = regex(
  "default-locale\\s*=\\s*[\"'](?<locale>[^\"']*)[\"']",
);
const DEFAULT_LOCALE_ATTR = /\s*default-locale\s*=\s*["'][^"']*["']/;

/**
 * Well-formed XML rooted in a `cs:style` element, which every CSL file is — a
 * dependent style as much as the independent style it points at.
 *
 * The whole document is read, so markup a processor would choke on — an
 * element left open, one closed as another — is answered as a file to repair,
 * rather than reaching citeproc and failing the render.
 *
 * @returns the root `cs:style` element, or `null` for content that is no CSL style.
 */
export function cslStyleRoot(xml: string): Element | null {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  // A parser that cannot read the content reports the failure inside the
  // document it hands back, as its root or beside the part it did read.
  if (parsed.getElementsByTagName(PARSER_ERROR).length > 0) return null;
  const root = parsed.documentElement;
  return root.localName === STYLE_ELEMENT ? root : null;
}

/**
 * Content a processor renders with on its own: a CSL style document that holds
 * the citation or bibliography it formats, laid out as CSL requires. A
 * dependent style declares neither of those, which is why it renders through
 * its independent parent.
 *
 * A rendering element without its layout formats nothing, so a style that
 * carries one is a file to repair rather than content citeproc is handed.
 */
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
      // The href is one style ID, which a parser hands over decoded; the
      // lookup that follows it names the parent by that very identity.
      const href = HREF.exec(tag)?.groups.href;
      return href === undefined ? undefined : decodeXmlText(href);
    }
  }
  return undefined;
}

/** The `default-locale` a style's root element declares. */
export function defaultLocaleOf(xml: string): string | undefined {
  const root = STYLE_ROOT.exec(xml)?.[0];
  const locale = root && DEFAULT_LOCALE.exec(root)?.groups.locale.trim();
  return locale ? decodeXmlText(locale) : undefined;
}

/**
 * The same style under `locale`, which the effective Citation Locale supplies
 * and a processor reads as the style's own default.
 *
 * @returns `xml` unchanged when no locale applies.
 */
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

/**
 * A title, a style ID, and the href naming an independent parent are all text a
 * parser hands over decoded, so the predefined XML entities decode here too —
 * an ID is compared against the one a document names, and a title is read.
 */
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

/** A locale reaches the style as an attribute value, so its markup escapes. */
function encodeXmlText(text: string): string {
  return text.replaceAll(/[&<>"]/g, (char) => XML_ESCAPES[char] ?? char);
}
