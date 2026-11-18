// The settings both wikilink display surfaces read: Live Preview and reading
// mode redraw Literature Note wikilinks as Citations while they hold.
import { Effect, Stream } from "effect";

import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import { citationSettings } from "@/services/citation-index/settings.ts";
import { hoverPreferences } from "@/services/citekey-navigation/index.ts";
import type { HoverPreferences } from "@/services/citekey-navigation/index.ts";

/**
 * The settings both wikilink display surfaces read, kept current for as long as
 * the surface consumes its {@link WikilinkDisplaySettings.redraws}.
 *
 * One tracker per surface, so Live Preview and reading mode answer to the same
 * settings without either restating which ones they are.
 */
export class WikilinkDisplaySettings {
  #enabled = false;
  #openAsLinks = citationSettings.defaults["citation.open-as-links"];
  #hover: HoverPreferences = hoverPreferences(citationSettings.defaults);

  /** The `enabled` of the wikilink citation core's `WikilinkCitationContext`. */
  get enabled(): boolean {
    return this.#enabled;
  }

  /** What hover answers with, read once per hover. */
  get hover(): HoverPreferences {
    return this.#hover;
  }

  /**
   * Whether a rendered Citation carries the Citation Popover's own hover. Under
   * every other Hover Action a Literature Note wikilink hovers as Obsidian's
   * own link, which is what it is, so no listener of the plugin's goes near it.
   */
  get popoverHover(): boolean {
    return this.#hover.action === "popover";
  }

  /**
   * Whether a plain click on a rendered Citation is the plugin's to answer:
   * Live Preview places the caret in the wikilink's source, and reading mode
   * lets the click land on static text. Wherever Citations open as links a
   * Literature Note wikilink clicks as Obsidian's own link, which is what it
   * is, so no listener of the plugin's goes near it.
   *
   * The click is read apart from the Hover Action, so it is answered even where
   * no hover would be.
   */
  get clickIntercepted(): boolean {
    return !this.#openAsLinks;
  }

  /**
   * Takes `next` as the current settings.
   *
   * @returns whether they change what a link displays or who answers its
   *   hover, which asks for a redraw.
   */
  apply(next: Readonly<Settings>): boolean {
    const enabled =
      next["citation.wikilink-citations"] && next["citation.show-formatted"];
    // Read straight through: a hover answers from the newest snapshot, and
    // only the listener the popover needs is drawn from it.
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

  /**
   * The settings in `changes` that change what a link displays or who answers
   * its hover, each one taken as the current settings. A surface redraws on
   * each.
   *
   * `changes` replays the current value first. That first snapshot only seeds
   * the values: everything drawn so far already read them, and a startup
   * redraw would show nothing new. The settings that arrive after it redraw
   * like any change.
   */
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
