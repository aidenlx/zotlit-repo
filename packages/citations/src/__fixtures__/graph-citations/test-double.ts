import type {
  GraphColorGroup,
  GraphColorGroupSection,
  GraphControlSection,
  GraphOptionListener,
  GraphOptions,
} from "obsidian";

export const NATIVE_DEFAULT_OPTIONS: GraphOptions = {
  showTags: false,
  showOrphans: true,
};

export class FakeControlSection implements GraphControlSection {
  readonly childrenEl: HTMLElement = createDiv();
  readonly optionListeners: Record<string, GraphOptionListener> = {};
  natives = 0;

  setDefaultOptions(): void {
    this.natives += 1;
    this.setOptions(NATIVE_DEFAULT_OPTIONS);
  }

  setOptions(options: GraphOptions): void {
    for (const [key, value] of Object.entries(options)) {
      this.optionListeners[key]?.(value);
    }
  }

  getOptions(): GraphOptions {
    const options: GraphOptions = {};
    for (const [key, listener] of Object.entries(this.optionListeners)) {
      const value = listener();
      if (value !== undefined) options[key] = value;
    }
    return options;
  }
}

export class FakeColorGroupSection implements GraphColorGroupSection {
  readonly childrenEl: HTMLElement = createDiv();
  #groups: GraphColorGroup[] = [];

  getColoredQueries(): GraphColorGroup[] {
    return this.#groups.map((group) => ({ ...group }));
  }

  setColorQueries(queries: GraphColorGroup[]): void {
    this.#groups = queries.map((group) => ({ ...group }));
    this.childrenEl.replaceChildren();
    this.childrenEl.createDiv("graph-color-groups-container");
    this.childrenEl.createDiv("graph-color-button-container", (el) => {
      el.createEl("button", { text: "New group" });
    });
  }
}
