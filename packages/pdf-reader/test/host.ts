import type { MenuItem, ReaderHost } from "#/core/index.ts";
import { regex } from "arkregex";

import { englishStrings } from "#/core/index.ts";

const PLACEHOLDER = regex("\\{(?<name>\\w+)}", "g");

export interface TestHost extends ReaderHost {
  readonly menus: (readonly MenuItem[])[];
  readonly copied: string[];
  readonly opened: string[];
  readonly reports: {
    readonly error: unknown;
    readonly extension: string | undefined;
    readonly phase: string;
  }[];
  choose(id: string): void;
}

export function testHost(name = "document.pdf"): TestHost {
  const values = new Map<string, unknown>();
  const host: TestHost = {
    menus: [],
    copied: [],
    opened: [],
    reports: [],
    t: (key, vars = {}) =>
      englishStrings[key].replaceAll(PLACEHOLDER, (whole, name: string) =>
        name in vars ? String(vars[name]) : whole,
      ),
    icon: (element, icon) => {
      element.dataset.icon = icon;
    },
    menu: (_at, items) => {
      host.menus.push(items);
    },
    copy: async (text) => {
      host.copied.push(text);
    },
    link: (subpath, alias) =>
      `[[${name}${subpath}${alias === undefined ? "" : `|${alias}`}]]`,
    openExternal: (url) => {
      host.opened.push(url);
    },
    storage: {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value);
      },
    },
    report: (error, where) => {
      host.reports.push({
        error,
        extension: where.extension,
        phase: where.phase,
      });
    },
    choose: (id) => {
      const item = host.menus.at(-1)?.find((entry) => entry.id === id);
      if (!item) throw new Error(`The last menu has no item ${id}`);
      item.run();
    },
  };
  return host;
}
