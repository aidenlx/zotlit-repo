import { regex } from "arkregex";

export interface VaultLink {
  readonly kind: "internal" | "external";
  readonly target: string;
  readonly text: string;
}

const WIKILINK = regex(
  "^\\[\\[(?<target>[^\\[\\]|]+)(?:\\|(?<alias>[^\\[\\]]+))?\\]\\]$",
);
const MARKDOWN_LINK = regex(
  "^\\[(?<text>[^\\[\\]]*)\\]\\((?<target>[^()\\s]+)\\)$",
);
const URL = regex("^[a-z][a-z0-9+.-]*://\\S+$", "i");
const EMAIL = regex("^[^\\s@:/]+@[^\\s@:/]+\\.[^\\s@:/]+$");

export function linkOf(value: string): VaultLink | null {
  const text = value.trim();
  const wiki = WIKILINK.exec(text);
  if (wiki) {
    const target = wiki.groups.target.trim();
    return {
      kind: "internal",
      target,
      text: wiki.groups.alias?.trim() || target,
    };
  }
  const markdown = MARKDOWN_LINK.exec(text);
  if (markdown) {
    const { target } = markdown.groups;
    const external = URL.test(target);
    return {
      kind: external ? "external" : "internal",
      target: external ? target : safeDecode(target),
      text: markdown.groups.text || target,
    };
  }
  if (URL.test(text)) return { kind: "external", target: text, text };
  if (EMAIL.test(text))
    return { kind: "external", target: `mailto:${text}`, text };
  return null;
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

export type DateType = "date" | "datetime";

const DATE = regex(
  "^(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})(?:[T ](?<hour>\\d{2}):(?<minute>\\d{2})(?::(?<second>\\d{2}))?)?$",
);

function partsOf(type: DateType, value: string) {
  const match = DATE.exec(value.trim());
  if (!match) return null;
  const { year, month, day, hour, minute, second } = match.groups;
  if (type === "datetime" && hour === undefined) return null;
  try {
    const plain = Temporal.PlainDateTime.from(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour ?? 0),
        minute: Number(minute ?? 0),
        second: Number(second ?? 0),
      },
      { overflow: "reject" },
    );
    return { plain, year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

export function dateInputValue(type: DateType, value: string): string {
  const parts = partsOf(type, value);
  if (!parts) return "";
  const { year, month, day, hour, minute, second } = parts;
  const date = `${year}-${month}-${day}`;
  return type === "date" ? date : `${date}T${hour}:${minute}:${second ?? "00"}`;
}

export function dateValue(
  type: DateType,
  field: string,
): string | null | undefined {
  if (field === "") return null;
  return partsOf(type, field) ? dateInputValue(type, field) : undefined;
}

export function tagText(tag: string): string {
  return tag.replace(/^#/, "");
}
