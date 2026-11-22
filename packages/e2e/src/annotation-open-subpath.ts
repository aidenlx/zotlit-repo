export function annotationOpenKeys({
  page,
  annotation,
  attachment,
}: {
  page: number;
  annotation: string;
  attachment: string;
}): Record<string, string> {
  return {
    page: String(page),
    "zt-annotation": annotation,
    "zt-attachment": attachment,
  };
}
