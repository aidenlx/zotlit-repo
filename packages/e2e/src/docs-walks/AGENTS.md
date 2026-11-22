# Docs walks

Each `<slug>.walk.ts` proves one lesson in the real apps. Use one test per lesson step, in reading order, and check the result the reader sees. Read expected UI text from the English messages. Record a product/lesson difference in an `OUTLINE-MISMATCH` comment. The walk slug names its media directory and take record and can differ from the page slug.

## Run a walk

1. Build the bundles with `pnpm exec turbo run build:dev --filter=@zotlit/obsidian --filter=@zotlit/zotero`.
2. Run `pnpm --filter @zotlit/e2e docs-walk src/docs-walks/<slug>.walk.ts`. Run one walk at a time. [openDocsWalk](docs-walk.ts) creates a fresh Paired Run. Set up prerequisites from earlier lessons in the walk’s `beforeAll`. Add missing scene data to the [Fixture Spec](../../../../docs/fixture.md).
3. Set `DOCS_WALK_CAPTURE=1` for step images or `DOCS_WALK_RECORD=1` for clips. Use `DOCS_WALK_ONLY=step-<n>` to record one step while still running its prerequisites. Output goes to the lesson’s media directory under `apps/docs/public/img/learn/`.

Walks take the host desktop’s Exclusive Hold. A recorded native step needs an unattended desktop, Screen Recording and the required automation permissions. Keep the other apps hidden and confirm the intended app is frontmost before sending real input. Use `DOCS_WALK_NATIVE=1` only for steps recording those interactions. Keep ordinary lesson checks reproducible offline.

## Capture and edit

- Use `walk.capture` for an Obsidian frame, `walk.compose` for a committed layer layout, and `walk.recordClip` for shots that cross apps. Capture a notice when the step asserts on it. For screenshots see the [docs-screenshot skill](../../../../.agents/skills/docs-screenshot/SKILL.md).
- Record a drag with `pointer.drag` so both ends stay visible. End the step with `pointer.look` on the result it proves. The [camera planner](camera.ts) and [clip settings](clip-settings.ts) own framing, pacing, and padding. Change action timing with a new recording.
- Use the take’s `recipe.record` to repeat the action and `recipe.recut` to edit existing frames. Takes live under `video/docs-walks/takes/` in the private video clone when present, otherwise under `.scratch/docs-walks/`. Commit private take changes in the video clone. Frames stay in scratch. For camera overrides, track selection, and encode options, use [clip-encode.ts](clip-encode.ts) with `--help`.
