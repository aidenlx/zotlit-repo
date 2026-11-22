import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { ExcerptImageDisplay } from "#desktop/excerpt-image/display.ts";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "#obsidian/annotation-repository/service.ts";
import { describe, expect, it } from "vitest";

import {
  excerptImageOwnership,
  excerptImageTarget,
} from "./excerpt-image-state.ts";
import type {
  ExcerptImageOwnership,
  ExcerptImageTarget,
} from "./excerpt-image-state.ts";

import { PNG_FORMAT } from "#core/excerpt-image/format.ts";

const SOURCE: AnnotationSource = {
  kind: "zotero-db",
  database: { userID: 1, localUserKey: "local", serverID: "server" },
  libraryID: 1,
  libraryRevision: 1,
};

function annotation(
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    key: "INK1",
    parentKey: "PDF1",
    type: "ink",
    color: "#ff0000",
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
    position: { kind: "pdf-ink", pageIndex: 0, width: 2, paths: [[20, 30]] },
    ...overrides,
  };
}

function stated(
  previous: ExcerptImageTarget | null,
  options: {
    annotation?: AnnotationRecord;
    source?: AnnotationSource;
    sourceScope?: string;
  } = {},
): ExcerptImageTarget {
  return excerptImageTarget(previous, {
    annotation: options.annotation ?? annotation(),
    source: options.source ?? SOURCE,
    sourceScope: options.sourceScope ?? "/fixture",
  });
}

const image = (byte: number): ExcerptImage => ({
  bytes: new Uint8Array([byte]),
  format: PNG_FORMAT,
});

function display(
  held: ExcerptImage | null,
  status: ExcerptImageDisplay["status"] = "settled",
): ExcerptImageDisplay {
  return { image: held, current: true, status };
}

const create = (one: ExcerptImage): string => `blob:${one.bytes[0]}`;

describe("Annotation Card image lifecycle", () => {
  it("retains the demand a published list states again for the same pixels", () => {
    const first = stated(null);

    expect(stated(first, { sourceScope: "/other-install" })).not.toBe(first);
    expect(
      stated(first, {
        annotation: annotation({ comment: "saved comment", version: 2 }),
      }),
    ).toBe(first);
    expect(stated(first, { annotation: annotation({ tags: ["tag"] }) })).toBe(
      first,
    );
    expect(
      stated(first, {
        source: { kind: "zotero-local-api", serverID: "server" },
      }),
    ).toBe(first);
    expect(
      stated(first, {
        source: { kind: "zotero-local-api", serverID: "other" },
      }),
    ).not.toBe(first);
  });

  it("states a new demand when the pixels or the Annotation move", () => {
    const first = stated(null);
    const recolored = stated(first, {
      annotation: annotation({ color: "#00ff00", version: 2 }),
    });
    expect(recolored).not.toBe(first);
    expect(recolored.identity).toBe(first.identity);
    expect(stated(recolored, { annotation: recolored.annotation })).toBe(
      recolored,
    );

    const other = stated(first, {
      annotation: annotation({ key: "INK2", parentKey: "PDF1" }),
    });
    expect(other.identity).not.toBe(first.identity);
  });

  it("keeps the URL a card owns while the display has nothing newer to paint", () => {
    const one = image(1);
    const held: ExcerptImageOwnership = {
      identity: stated(null).identity,
      image: one,
      url: "blob:1",
    };

    for (const status of ["reading", "failed"] as const) {
      expect(
        excerptImageOwnership({
          held,
          display: display(null, status),
          identity: held.identity,
          create,
        }),
      ).toEqual({ owned: held, release: [] });
    }
    expect(
      excerptImageOwnership({
        held,
        display: display(one),
        identity: held.identity,
        create,
      }),
    ).toEqual({ owned: held, release: [] });
  });

  it("replaces the URL when another image arrives and releases the one it replaced", () => {
    const identity = stated(null).identity;
    const held: ExcerptImageOwnership = {
      identity,
      image: image(1),
      url: "blob:1",
    };

    const replaced = excerptImageOwnership({
      held,
      display: display(image(2)),
      identity,
      create,
    });
    expect(replaced.owned).toEqual({
      identity,
      image: image(2),
      url: "blob:2",
    });
    expect(replaced.release).toEqual(["blob:1"]);
  });

  it("releases the URL when a manual clear takes the image away", () => {
    const identity = stated(null).identity;
    const held: ExcerptImageOwnership = {
      identity,
      image: image(1),
      url: "blob:1",
    };

    expect(
      excerptImageOwnership({
        held,
        display: display(null, "cleared"),
        identity,
        create,
      }),
    ).toEqual({ owned: null, release: ["blob:1"] });
  });

  it("releases the URL when the card paints another Annotation", () => {
    const held: ExcerptImageOwnership = {
      identity: stated(null).identity,
      image: image(1),
      url: "blob:1",
    };
    const other = stated(null, {
      annotation: annotation({ key: "INK2" }),
    }).identity;

    expect(
      excerptImageOwnership({
        held,
        display: display(null, "reading"),
        identity: other,
        create,
      }),
    ).toEqual({ owned: null, release: ["blob:1"] });
    expect(
      excerptImageOwnership({
        held,
        display: display(image(3)),
        identity: other,
        create,
      }),
    ).toEqual({
      owned: { identity: other, image: image(3), url: "blob:3" },
      release: ["blob:1"],
    });
  });
});
