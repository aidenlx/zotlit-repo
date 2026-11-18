// A settings slice: the keys one owner keeps in the plugin settings, with
// their schemas and defaults. A host composes every slice into one
// `SettingsDefinition` for `PluginSettings`.
import * as v from "valibot";

/**
 * JSON-safe values a setting may take. Recursive so structured settings (e.g.
 * `note.frontmatter-fields`) round-trip through `data.json`. The array / index
 * branches are `readonly` so `v.readonly()`-typed settings stay assignable to
 * this guard.
 */
export type SettingsValue =
  | string
  | number
  | boolean
  | null
  | readonly SettingsValue[]
  | { readonly [key: string]: SettingsValue };

/** Any JSON value, unchecked past its being JSON: its owner reads it. */
export const jsonValueSchema: v.GenericSchema<SettingsValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(jsonValueSchema),
    v.record(v.string(), jsonValueSchema),
  ]),
);

/** JSON-safe finite number that settings values may take. */
export const settingsNumber = v.pipe(v.number(), v.finite());

/** The schema of each key in a slice. */
export type SettingsEntries = Record<
  string,
  v.GenericSchema<unknown, SettingsValue>
>;

/** The values of `entries`, as `v.object(entries)` outputs them. */
type EntriesOutput<TEntries extends SettingsEntries> = v.InferOutput<
  v.ObjectSchema<TEntries, undefined>
>;

/** The keys one owner keeps, their schemas, and their defaults. */
export interface SettingsSlice<TEntries extends SettingsEntries> {
  readonly entries: TEntries;
  readonly defaults: Readonly<EntriesOutput<TEntries>>;
}

/** The values of a slice's keys, as the settings snapshot carries them. */
export type SliceSettings<TSlice extends SettingsSlice<SettingsEntries>> =
  EntriesOutput<TSlice["entries"]>;

/**
 * A slice of the plugin settings. The defaults name every key of `entries`,
 * so a key never lacks a value.
 */
export function settingsSlice<const TEntries extends SettingsEntries>(
  entries: TEntries,
  defaults: EntriesOutput<TEntries>,
): SettingsSlice<TEntries> {
  return { entries, defaults: Object.freeze(defaults) };
}
