# Ink is stored as Zotero smooths it, and one stroke is one Annotation

The ink tool in Obsidian's PDF reader stores each Ink Stroke as the points Zotero's own reader would store for the same hand movement: two Chaikin passes that keep the first and last points, then a filter that drops every point under one PDF point from the last kept one, rounded to three decimals. Every renderer draws the stored points as straight segments with round caps and joins; nothing is curved at render time, and pressure is never used. One Ink Stroke makes one ink Annotation, created through the Zotero Local API with its own Page Label and Sort Index.

Zotero's reader, its canvas renderer, its Excerpt Image renderer, and its PDF export all draw ink as straight segments between the stored points. A curve drawn in ZotLit from sparse points would look different in Zotero, and sparse points would weaken Zotero's vertex-based eraser. The smoothing therefore has to be in the stored points, and it has to be Zotero's, so that the two applications show the same ink and point density.

## Considered Options

- **Curves at render time over sparse stored points** (rejected): the approach of pdf.js and tldraw. ZotLit would show a smooth stroke, and Zotero would show a chain of straight chords over the same points.
- **A different smoother or a simplifier** (rejected): a streamline or a point-reduction pass changes the density Zotero's eraser and merge expect, and the two applications drift apart.
- **Zotero's smoothing, stored; straight segments drawn** (chosen): a port of Zotero's `smoothPath` runs on every published frame and at release, so the stroke the user sees while drawing is the stroke that is saved.
- **Append a stroke to the previous ink Annotation, as Zotero does** (rejected): the append is a position update that drops the Annotation's Excerpt Image, and it makes each position larger. One create per stroke is simpler, and the user merges strokes in Zotero when wanted.

## Consequences

- The Live Stroke and the saved mark use one path builder, so the handoff at release does not change the shape. ZotLit shows the smoothed path while drawing, where Zotero shows raw points until pointer-up.
- A stroke whose rounded position would pass the sixty-five-thousand-character ceiling ends there: the finished part is created as its own Annotation, and the stroke continues with the pointer and the tool held, as a new part that begins at the finished part's last point and takes the next sample, so the two Annotations meet. The new part is measured afresh. The length is measured in full only near the ceiling, because one more sample adds at most seven smoothed points.
- The width is one value per Annotation, chosen from a short set of Zotero's own width steps (0.4, 1, 2, 3, 5, 8, and 12 points) before the press, and fixed for the stroke. Colour is fixed at the press too.
- Handwriting one word gives several Annotations.

## Sampling and hit geometry

A stroke stays with the pointer and page that took the press. The live stroke
publishes its first point immediately so a tap shows a dot. It consumes
coalesced browser events when present and measures each sample against the
page's current geometry to follow scroll or zoom. It clamps to the press
page and keeps samples at least one PDF point apart. The reader window
publishes later samples on its own animation frames. A split hands off the
finished part and immediately shows the new part without redrawing the old one.

The smoothing filter can drop the final point of a straight stroke. Its
tests use expected values from Zotero's implementation. The sizing bound
uses the widest rounded coordinate, including its comma. Each corner-cutting
pass keeps the endpoints and replaces a segment with quarter and three-quarter
points. After two passes an additional sample can make the last three
smoothed points give way to seven. The size tests exercise both the split
threshold and varied point spacing.

Ink hit reach is the full pen width or seven PDF points, whichever is larger.
Distance to segments makes the middle of a long line in imported ink
selectable. A one-point stroke uses distance to the point.

[Zotero smoothing](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/path.js#L1-L49)
[Zotero hit reach](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/utilities.js#L138-L148)

An armed ink tool claims a main-button gesture before mark selection, including a dot or a gesture that editing blocks. The click at the end does not select a mark.

Give an Ink Stroke a process-wide group serial because different Reader views of the same Attachment share its history. All split parts use that group. A split leaves the pointer and tool active and starts a new part at the shared endpoint. A second pointer discards the current stroke and cannot start its own in the same press, allowing a pinch. Keep the color the stroke started with. Put completed parts in the Pending Strokes list and send them serially in release order. A sent stroke can finish when the view closes, while queued strokes cancel with the view. Recheck edit capability when a stroke finishes and when a queued stroke starts. Remove a refused pending stroke. A confirmed stroke draws from the saved record when available. The integration tests check the smoothing coordinates, clamping at the press-page edge, and undo across split parts and views. [Ink creation](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/creation.ts) · [Creation tests](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/creation.test.ts)

Keep the Live Stroke and Pending Strokes outside the floating popup state. Match a read-back stroke by key or by the stored points, pen width, and color when the read arrives before the create returns its key. The matching path swaps the preview for the record in one update. One record can replace the preview for two identical strokes while they overlap. The second stroke has its own record when its create lands.

Publish the Live Stroke on its press page once per animation frame and draw pending strokes below the confirmed marks. Disable touch panning over pages while ink is armed, because the browser decides touch handling at contact.

### Paired ink gestures

Put the sampled path inside the page and clear of seeded
marks. Sample the live stroke after its frame. On release,
read the pending stroke immediately because a queued create
publishes it before returning. Chaikin preserves the initial
point and the close-point filter can drop the last. A dot
uses coincident move and line endpoints with round caps.
The tool remains armed after a stroke. Verify the chosen
width in its menu and in a new Reader binding. DOM menu
tests disable native menus.

After creating ink, let Zotero's Reader finish saving its
Excerpt Image before erasing the new record. Erasing it first
can let the pending image write restore the item. Remove any
create that arrived after a failed test stopped observing.
Wait for the erased overlay marks to leave before reusing
the same gesture points.

[Paired ink cases](../../../../packages/e2e/src/paired-annotation-tools.e2e.ts)

For an ink geometry case, sample the box and corner handle
after the page jump settles. Check coordinates from stored PDF
points with allowance for client-pixel conversion. Reopening
the Zotero Reader makes missing Excerpt Images render before
later writes. A click inside the stroke box but off the ink
can clear selection. Use a point clear of both arms of the
seeded tick to distinguish box and stroke hit testing.

Only corner handles scale ink. A corner drag uses horizontal
travel to set scale and keeps the opposite corner fixed.
Check the Local API position, Reader position, overlay, and
pixel-change signal against the same saved stroke.

[Ink geometry cases](../../../../packages/e2e/src/paired-mark-handles.e2e.ts)
