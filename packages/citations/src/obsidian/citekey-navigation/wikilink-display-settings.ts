import { Effect, Stream } from "effect";

import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import { hoverPreferences } from "./index.ts";
import type { HoverPreferences } from "./index.ts";

import { citationSettings } from "#core/citation-index/settings.ts";

export class WikilinkDisplaySettings {
  #enabled = false;
  #openAsLinks = citationSettings.defaults["citation.open-as-links"];
  #hover: HoverPreferences = hoverPreferences(citationSettings.defaults);

  get enabled(): boolean {
    return this.#enabled;
  }

  get hover(): HoverPreferences {
    return this.#hover;
  }

  get popoverHover(): boolean {
    return this.#hover.action === "popover";
  }

  get clickIntercepted(): boolean {
    return !this.#openAsLinks;
  }

  apply(next: Readonly<Settings>): boolean {
    const enabled =
      next["citation.wikilink-citations"] && next["citation.show-formatted"];
    const popoverHover = this.popoverHover;
    const clickIntercepted = this.clickIntercepted;
    this.#hover = hoverPreferences(next);
    this.#openAsLinks = next["citation.open-as-links"];
    const changed =
      enabled !== this.#enabled ||
      popoverHover !== this.popoverHover ||
      clickIntercepted !== this.clickIntercepted;
    this.#enabled = enabled;
    return changed;
  }

  redraws(changes: Stream.Stream<Readonly<Settings>>): Stream.Stream<void> {
    return changes.pipe(
      Stream.map((next) => this.apply(next)),
      Stream.drop(1),
      Stream.filter((changed) => changed),
      Stream.mapEffect(() =>
        Effect.logDebug("Wikilink display settings changed").pipe(
          Effect.annotateLogs({
            enabled: this.#enabled,
            popoverHover: this.popoverHover,
            clickIntercepted: this.clickIntercepted,
          }),
        ),
      ),
    );
  }
}
