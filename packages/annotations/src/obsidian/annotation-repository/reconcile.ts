import type { AnnotationPosition } from "@zotlit/db";

import type { ConflictedWrite, GeometryEdit } from "./write.ts";
import { wireColor, writablePosition, writePosition } from "./write.ts";

export function resolvesSilently(
  write: Exclude<ConflictedWrite, "geometry">,
  attempted: string | null,
  fresh: string | null,
): boolean {
  if (write === "delete") return false;
  if (write === "color") {
    return (
      attempted !== null &&
      fresh !== null &&
      wireColor(attempted) === wireColor(fresh)
    );
  }
  return (attempted ?? "") === (fresh ?? "");
}

export function sameStoredGeometry(
  attempted: GeometryEdit,
  fresh: { position: AnnotationPosition; text: string | null },
): boolean {
  return (
    writePosition(attempted.position) === storedPosition(fresh.position) &&
    (attempted.text === undefined || attempted.text === fresh.text)
  );
}

export function storedPosition(position: AnnotationPosition): string | null {
  const writable = writablePosition(position);
  return writable === null ? null : writePosition(writable);
}
