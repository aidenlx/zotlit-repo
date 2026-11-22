# Recordings and skill archives ship as immutable assets

## Context

The docs site serves videos and installable skill archives from URLs that can use long-lived caches. Generators must keep the URLs, digests, and bytes in agreement.

## Recordings

Keep source MP4 clips in Git LFS under the lesson media folders and landing cases. Derive the media-store key from the relative path and the first eight hex digits of SHA-256. Both docs lines share the R2 bucket. The uploader checks each key with HEAD and sends a cacheable MP4 on a 404. A dry run does the lookup only, and failed responses outside the supported cases stop the upload. A production build with the media origin uses this same key map and removes its copied clips from the client output after Vite copies the public files. Stills remain with the site. Local development and builds without that origin use the original site paths.

Scan lesson stills, optional posters, and clips by folder and numbered step so new recordings need no edit to the lesson. Keep the static still when a recording is missing. Skip Git LFS pointers, and use the still dimensions if the clip header cannot supply display dimensions. Read the MP4 track header dimensions as fixed point. Version 1 has wider times and moves the size fields twelve bytes later. Ignore zero-dimension track headers. Share a single scan at build time, and rescan files on development media changes. Pass the inventory as `__LEARN_MEDIA__` and the media URL map as `__MEDIA_URLS__`.

## Skill archives

Build the installable archive and discovery index together from the checked-out skill and OpenAI metadata. Keep evaluation fixtures and their runtime in the repository. Publish both at the static `/.well-known/agent-skills` paths, using the selected docs line's origin. Pin archive URLs to the build commit and digest the exact bytes that the index references. The ZIP must avoid both the build clock and the build time zone. Two builds in different time zones currently emit different bytes at the same URL. [Archive reproducibility follow-up](https://github.com/aidenlx/zotlit-repo/issues/116)

The discovery index follows the [Agent Skills discovery schema](https://schemas.agentskills.io/discovery/0.2.0/schema.json).

### Camera and encoding

Log each action in clip seconds and window CSS pixels. Start
wide and prefer a stable shot. Hold a shot long enough to show
the actions due before the next move can arrive. Zoom only
when an action group and its context fit a tighter shot. If
the next action is outside the view, widen to include both
regions. Keep the window aspect ratio, clamp the crop to the
window, and ease between different keyframes. Pointer-only
moves do not change the crop. A look action frames an explicit
area.

A drag shows its press and release together. Set that view by
the lead time before the press and keep it until release.
Widen the prior shot if an eased move would arrive too late.
Frame typing and clicks with their context, including an
element only when it fits the crop. Extend the first and last
frame holds to meet the minimum opening and closing shot
duration without altering the shot's action times. The camera
tests cover widening after typing, drag endpoints on the
edges, and a first shot that ends in a cut.

Keep the recorded frames and camera log for a recut. A
hand-authored track can replace the plan for one clip. A
sequence joins shot directories, each with its own track or
whole-window choice. Reuse the recording settings and use
the current camera and pad settings, dropping retired
settings. Apply defaults, then walk values, then the file
and inline environment overrides. Use page arguments to
share pointer styling among Obsidian, Zotero, and browser
shots. End the CSS glide before its action wait completes.

Bake one image per output tick at the first shot's ratio.
Reuse a source frame and crop when several ticks are equal.
Use hard links for repeated images so ffmpeg reads the exact
frame rate. A concat list rounded timing to 1/25 second and
made camera moves judder. Blur private regions before cropping
so none of their text stays legible. Use the final image for
the poster. Camera-off output keeps the whole window.
H.264 CRF 32 keeps interface text legible at site size and
avoids the size observed with quality 20 and camera moves.

### Take records

Keep action logs, tracks, recorder commit and dirty state,
reported app versions, settings, duration, and output sizes.
The record includes only `DOCS_WALK_*` switches. Read the
version pin from the committed vault script so a local edit
shows as a bypass. Keep build, record, and recut commands.
Recording one clip can run earlier steps to establish its
state. Set the native switch for a real desktop input
recording. Store take records under the private video clone
when present, or in scratch. Keep the raw frames out of Git.

[Camera](../../../../packages/e2e/src/docs-walks/camera.ts) ·
[Encoder](../../../../packages/e2e/src/docs-walks/clip-encode.ts) ·
[Settings](../../../../packages/e2e/src/docs-walks/clip-settings.ts) ·
[Take records](../../../../packages/e2e/src/docs-walks/takes.ts)

### Recording across apps

Start a headless browser with a fresh profile so recording
shows page content without the user's history, accounts, or
extensions. Match the Obsidian viewport at 2× pixel density.
Await page load, fonts, and the lesson's own readiness
predicate. Disable ambient component downloads and allow
only the requested download before restoring the policy.
Tear down Chrome and its profile after use or a failed start.
Serialize the pointer into the page with its data, on the
same clock as the recording frames.

Capture layers only when requested. Compose the named layer
files from the layout next to the captures. With no layout,
center one window without traffic lights. Use the walk's
name for overrides and recordings and its output collection
for the lesson's media. Allow a clip filter to select
recordings while all lesson steps still execute. For mixed
shots, keep a common encoding contract and allow rollback
of the later shots when a capture needs retrying.

A screenshot normally clears notices and waits for the DOM
to paint. A step that shows a notice can keep or hold it
until the last shot and take its still immediately after the
action, before the clip's rest. Preserve its screen position
and undo the dismiss animation while holding it. Keep the
drawn pointer out of that still. The resolved layer is reused
by a later capture call.

Raise Zotero for its recording because macOS window capture
can return black when the app is behind. A dialog uses a
region capture because direct dialog capture can return
black. Check the selected window is unobscured before
capture. Allow time for `screencapture` to start because it
writes the movie only at stop. Stop before an action that
closes the captured window. Use the drawn pointer in the
captured app window and use real input for native shots.

Keep the drawn arrow within the viewport. Aim slightly
inset on wide controls so the pointer covers less of their
text. Move it away during typing and log the caret region,
using the line on an empty line. Frame only visible target
bounds. Finish the final camera move before the clip's
rest. Keep the opening scene before the first action and
leave out the camera wait when the camera is off.

[Browser shots](../../../../packages/e2e/src/docs-walks/docs-browser.ts) ·
[Walk recording](../../../../packages/e2e/src/docs-walks/docs-walk.ts)

### Installation and approval shots

Record the real community install only when making the clip,
because it fetches the release. Keep the Fixture builds in
scratch during that shot. Open Settings in the vault window
so its screencast captures it, and start on Editor to keep
account details out of frame. Use the clean browser for the
installation guide and download.

Use native input for the Zotero menu bar, file dialog, and
approval button only under the native recording switch.
Otherwise install from the downloaded file or drive approval
through RDP. Move the file dialog to a scratch Downloads
folder in icon view between shots. End the prior shot before
the dialog exposes its last folder. Frame the download and
its buttons. Blur the status area, sidebar, and toolbar in
every native frame, even when the crop normally hides them.
Restore the prior dialog view and Obsidian visibility after
the shot. If focus spoils a shot, reset that Zotero sequence
before retrying.

During the approval clip, hold the Obsidian notice before
pressing in Zotero because the notice appears while Zotero
has focus. Keep unrelated Obsidian vaults hidden during
the native shot. End the shot as the dialog closes. Capture
the return shot and its still while the notice and enabled
tools remain visible. Gecko canvas capture supplies a
Zotero still without screen-recording permission.

[Install recording](../../../../packages/e2e/src/docs-walks/connect-zotero-to-obsidian.walk.ts) ·
[Approval recording](../../../../packages/e2e/src/docs-walks/annotate-pdfs-in-obsidian.walk.ts)
