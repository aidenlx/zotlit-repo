import {
  LibraryScopeStub,
  MY_LIBRARY_ID,
  GROUP_LIBRARY_ID,
  KEY_A,
  personalLibrary,
  groupLibrary,
} from "./test-harness.ts";
export const GROUP_KEY = "GRP12345g7";
export const TWIN_KEY = "RVW23456";

export const myLibraryRow = {
  itemID: 1,
  libraryID: MY_LIBRARY_ID,
  key: KEY_A,
  indexedKey: KEY_A,
  citekey: "doe2024",
};
export const sameLibraryTwin = {
  itemID: 2,
  libraryID: MY_LIBRARY_ID,
  key: TWIN_KEY,
  indexedKey: TWIN_KEY,
  citekey: "doe2024",
};
export const groupTwin = {
  itemID: 1,
  libraryID: GROUP_LIBRARY_ID,
  key: "GRP12345",
  indexedKey: GROUP_KEY,
  citekey: "doe2024",
};

export function bothLibraries(): LibraryScopeStub {
  return new LibraryScopeStub([personalLibrary(), groupLibrary()]);
}
