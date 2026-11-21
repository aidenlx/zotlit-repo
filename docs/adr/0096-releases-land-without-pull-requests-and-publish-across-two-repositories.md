---
status: superseded in part by ADR-0097, ADR-0102
---

# Releases land without pull requests and publish across two repositories

> **Superseded in part by [ADR 0102](0102-each-land-opens-a-record-pull-request.md).** Each land opens a record pull request from its task branch, and the land's push of `main` shows it as merged. The release version commit still lands with no pull request.

> **Superseded in part by [ADR 0097](0097-main-is-the-one-trunk.md).** Every release is a version commit on `main`, and the version alone picks the line. The graduation, `pnpm land --to main --hotfix`, the merge path of the Land Queue, the version rules that kept two branches in order, and "the line decides the branch" are gone; a stable hotfix publishes from a local branch cut from the latest stable release tag. The publish across two repositories, the source tag as the gate, and the history of the publish repository remain.

Replaces the pull-request parts of [ADR 0021](0021-next-is-the-primary-branch.md) and [ADR 0076](0076-checks-run-before-push-and-ci-runs-only-to-release.md). Amends [ADR 0084](0084-changes-land-on-next-through-a-serial-queue.md) (a hotfix land onto `main`; a branch with a merge commit takes its target by a merge) and [ADR 0095](0095-the-publish-repository-is-a-thin-generated-shell.md) (the release flow that uses the shell).

## Context

The source is in `aidenlx/zotlit-repo`; changes land on `next` through `pnpm land` (ADR 0084), and that repository has no pull requests. The publish repository `aidenlx/zotlit` holds a generated shell that builds the plugin from the npm bundle package (ADR 0095), and all releases: the plugin `x.y.z`, the Resource Releases `res-x.y.z`, the Companion `zt-x.y.z` and the rolling `zotero-release`. `pnpm release` still opened release pull requests, and `release.yml` assumed it ran in the repository it published to.

## Decision

```text
person               pnpm release ─▶ version commit ─▶ Land Queue
                       beta:       land into next, gate pnpm verify --release
                       graduation: land into next, gate pnpm verify;
                                   then land --to main, gate pnpm verify --release
                       hotfix:     land --to main --hotfix, gate pnpm verify --release

aidenlx/zotlit-repo  release.yml on a push to next or main
                       plan    a product publishes when its version is on the pushed
                               branch's line and this repository has no release tag
                       verify  pnpm verify --release (desktop checks skip)
                       obsidian  pnpm release:publish obsidian
                                 build ─▶ pack ─▶ npm (OIDC, provenance, beta|latest)
                                 ─▶ registry ─▶ shell (lockfile from npm) ─▶ check
                                 (frozen install, build, byte compare) ─▶ commit
                                 ─▶ atomic push of branch + tag (RELEASE_REPO_TOKEN)
                                 ─▶ the tag here (GITHUB_TOKEN)
                       zotero    pnpm release:publish zotero
                                 build ─▶ zt-<v> ─▶ update manifests ─▶ zotero-release
                                 ─▶ the tag here

aidenlx/zotlit       the shell's plugin-release.yml on the tag (its own GITHUB_TOKEN)
                       official action ─▶ res-<v> ─▶ publish the release
```

- **No pull requests.** `pnpm release` bumps versions, commits on a local branch and lands that commit through the Land Queue. The release gate runs once per release, in a Land Turn, on the tree that is pushed. The version rules of ADR 0021 stay: the version picks the line, the branch picks the offered bumps, a graduation takes every app, one release does not mix lines, and `origin/main` must be an ancestor of a graduation.
- **Graduation is a fast-forward.** `main` moves to the version commit of `next`, so after a graduation the two branches are one commit, and the "merge main back into next" step of ADR 0021 goes away.
- **Hotfix land.** `pnpm land --to main --hotfix` lands a task branch off `main` onto `main` with the release gate. The fix reaches `next` through a branch that merges `origin/main`. A land of a branch that holds a merge commit takes the newest target by a merge, not a rebase, so `main` stays an ancestor of `next`.
- **The line decides the branch.** A pre-release version publishes from `next`, a stable version from `main`; a stable version on `next` waits for its graduation.
- **The release tag of the source repository is the gate.** It is the last step of each product's publish. Every step before it finds what an earlier run did: a version on npm with the same files, a tag in the publish repository on the same tree, a branch tip with the same tree, a source tag on the same commit. A version or a tag with other content stops the run.
- **The publish repository's history stays.** A stable shell commit goes on `main` of `aidenlx/zotlit`, a beta on `beta`; the first beta, and a beta after a stable release that `beta` lacks, also takes `main` as a parent. No push needs force, and `main` keeps the stable `manifest.json` that the directory reads.
- **Logic in scripts.** The steps live in `packages/scripts/lib/release/`, with each outward step injected; `release.yml` calls `pnpm release:publish <product>`. The same command runs on a machine, and `--dry-run` runs it with a local registry, a bare clone of the publish repository, and no tag.
- **Credentials.** npm trusted publishing (`id-token: write`) for the bundle package; the first publish runs once from the lead's machine, since a package must exist before trusted publishing can be set. `RELEASE_REPO_TOKEN` (Contents and Workflows write on `aidenlx/zotlit`) pushes the shell and writes the Companion releases; a tag it pushes starts the shell's workflow, where a `GITHUB_TOKEN` push would not. `GITHUB_TOKEN` pushes the tag in the source repository.

## What this replaces

- ADR 0021: release-branch pull requests from `next` to `main`; hotfix pull requests on `main`; the sync-back merge after a graduation; "CI triggers on pushes to both branches, no workflow changes" (the workflow now filters by line).
- ADR 0076: the release pull request and "the script offers to merge the PR"; the diagram's `release branch ── PR ── merge`; `release.ts` gating before the version commit exists (it now gates inside the land); the considered option "Release from a tag push" (the publish is now driven by the branch push and closes with a tag, and `main` takes no pull request).

## Considered options

- **Publish from a tag push in the source repository.** A person or `release.ts` would push the tag, and the workflow would start on it. A failed publish would then leave a tag that claims a release, and the tag could no longer be the gate that a re-run reads.
- **Keep a placeholder npm version for the first publish.** It lets every real version publish from CI with provenance, at the cost of a `0.0.0` version that holds `latest` until the first stable release.
- **Force-push `beta` after each stable release.** It keeps `beta` linear, and needs a force push in the publish repository; a second parent gives the same tree without one.
- **Run the release gate before the version commit, as before.** It gates a tree that the land then rebases; inside the Land Turn it gates the tree that is pushed, once.

## Consequences

- A beta's Land Turn of `next` lasts as long as the release gate with its End-to-end Run; other lands wait behind it.
- A stable version commit can stay on `next` without a release when its graduation fails; the fix lands into `next`, then `pnpm land --to main` graduates the new tip.
- A version published to npm is final. A fix that changes the bundle after the npm step needs a new version.
- `aidenlx/zotlit` runs only the shell's workflow on its tags; its old monorepo workflows on `main` and `next` are disabled by hand. GitHub keeps a workflow's disabled state by file path, so the shell's workflow is `plugin-release.yml`, not `release.yml`.
