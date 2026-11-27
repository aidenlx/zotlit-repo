import type { FakeLibrary } from "./fake-zotero-api.ts";

const KEY_ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
const COLLECTIONS = 20;
const TAGS = 50;

function seedKey(prefix: string, index: number): string {
  let key = "";
  for (let rest = index; key.length < 7; rest = Math.floor(rest / 33))
    key = KEY_ALPHABET[rest % 33] + key;
  return prefix + key;
}

export const seedItemKey = (index: number): string => seedKey("I", index);
const seedCollectionKey = (index: number): string => seedKey("C", index);

export interface SeedLibraryOptions {
  readonly items: number;
}

export function seedLibrary(
  library: FakeLibrary,
  { items }: SeedLibraryOptions,
): void {
  for (let index = 0; index < COLLECTIONS; index++)
    library.putCollection({
      key: seedCollectionKey(index),
      name: `Seed collection ${index + 1}`,
      parentCollection: false,
      relations: {},
    });
  for (let index = 0; index < items; index++)
    library.putItem({
      key: seedItemKey(index),
      itemType: "journalArticle",
      title: `Seeded study ${index + 1} of reading habits`,
      date: `${1990 + (index % 35)}`,
      publicationTitle: `Journal of Seeded Research ${(index % 12) + 1}`,
      abstractNote: `An abstract for seeded study ${index + 1}.`,
      creators: [
        { creatorType: "author", firstName: "Ada", lastName: `Seedwright${index % 400}` },
        { creatorType: "author", firstName: "Ben", lastName: `Fieldhand${index % 900}` },
      ],
      tags: [{ tag: `seed-tag-${index % TAGS}` }, { tag: `seed-tag-${(index + 7) % TAGS}` }],
      collections: [seedCollectionKey(index % COLLECTIONS)],
      relations: {},
      dateAdded: "2026-01-05T10:00:00Z",
      dateModified: "2026-01-05T10:00:00Z",
    });
}

export function changeSeededItems(
  library: FakeLibrary,
  { items, round }: { readonly items: number; readonly round: number },
): void {
  for (let index = 0; index < items; index++)
    library.updateItem(seedItemKey(index), {
      title: `Seeded study ${index + 1} of reading habits, revision ${round}`,
      dateModified: Temporal.Instant.from("2026-02-01T00:00:00Z")
        .add({ seconds: round })
        .toString(),
    });
}
