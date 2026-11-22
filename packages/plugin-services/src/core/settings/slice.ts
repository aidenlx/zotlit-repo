import * as v from "valibot";

export type SettingsValue =
  | string
  | number
  | boolean
  | null
  | readonly SettingsValue[]
  | { readonly [key: string]: SettingsValue };

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

export const settingsNumber = v.pipe(v.number(), v.finite());

export type SettingsEntries = Record<
  string,
  v.GenericSchema<unknown, SettingsValue>
>;

type EntriesOutput<TEntries extends SettingsEntries> = v.InferOutput<
  v.ObjectSchema<TEntries, undefined>
>;

export interface SettingsSlice<TEntries extends SettingsEntries> {
  readonly entries: TEntries;
  readonly defaults: Readonly<EntriesOutput<TEntries>>;
}

export type SliceSettings<TSlice extends SettingsSlice<SettingsEntries>> =
  EntriesOutput<TSlice["entries"]>;

export function settingsSlice<const TEntries extends SettingsEntries>(
  entries: TEntries,
  defaults: EntriesOutput<TEntries>,
): SettingsSlice<TEntries> {
  return { entries, defaults: Object.freeze(defaults) };
}
