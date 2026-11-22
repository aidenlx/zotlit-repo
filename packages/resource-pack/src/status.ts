import type { PackFailure } from "#format.ts";

export type PackBinaryRefusal =
  | { readonly kind: "pack-absent" }
  | { readonly kind: "pack-outdated" }
  | { readonly kind: "plugin-outdated" }
  | { readonly kind: "pack-damaged" }
  | { readonly kind: "failed"; readonly detail: string };

export type PackBinaryStatus =
  | PackBinaryRefusal
  | { readonly kind: "ready"; readonly version: string };

export function refusalStatus(failure: PackFailure): PackBinaryRefusal {
  switch (failure.kind) {
    case "pack-absent":
      return { kind: "pack-absent" };
    case "plugin-outdated":
      return { kind: "plugin-outdated" };
    case "pack-outdated":
    case "entry-missing":
      return { kind: "pack-outdated" };
    case "entry-damaged":
    case "pack-unreadable":
      return { kind: "pack-damaged" };
  }
}
