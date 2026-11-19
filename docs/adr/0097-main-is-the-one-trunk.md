---
status: accepted
---

# main is the one trunk

Supersedes [ADR 0021](0021-next-is-the-primary-branch.md). Supersedes in part [ADR 0084](0084-changes-land-on-next-through-a-serial-queue.md) (the target branch, the graduation land) and [ADR 0096](0096-releases-land-without-pull-requests-and-publish-across-two-repositories.md) (the graduation, the hotfix land, the merge path of the Land Queue, and the branch that each line publishes from).

`aidenlx/zotlit-repo` has one long-lived branch, `main`. Every change lands on it through `pnpm land`. Every release, beta or stable, is a version commit on it, made by `pnpm release` and landed with the release gate. The branch `next` is gone, and no other branch is pushed to `aidenlx/zotlit-repo`.

```text
task branch ──pnpm land (pnpm verify)──────────────▶ main
main ──pnpm release (pnpm verify --release)─────────▶ main + version commit
                                                       │ release.yml, on the push
            version 2.4.0-beta.N ─▶ beta line:   npm `beta`, GitHub pre-release, update-beta.json
            version 2.4.0        ─▶ stable line: npm `latest`, update.json,
                                                 production docs from the tag 2.4.0
```

## Why

In the two-repository system (ADR 0095, ADR 0096) a second branch of the source repository holds no state of its own:

- The "latest stable" of the plugin directory (`manifest.json`, `versions.json`) lives on `main` of the publish repository `aidenlx/zotlit`, which keeps its `main` and `beta` shell branches.
- The release line follows the version: a pre-release version goes to npm `beta`, a GitHub pre-release and `update-beta.json`; a stable version goes to npm `latest` and `update.json`.
- The code of a release is its tag in `aidenlx/zotlit-repo`.

So `main` beside `next` only duplicated that state, and it cost a graduation step, a hotfix land, a merge path in the Land Queue, a second queue, and guards that kept the two branches in order.

## Decision

- **Land.** `pnpm land` rebases a task branch onto `origin/main`, runs `pnpm verify`, and pushes to `main`. There is one Land Queue. `--to main`, `--hotfix` and the merge path (a branch with a merge commit took the target by a merge) are gone: a branch rebases as any other.
- **Release.** `pnpm release` runs on `main` only. The version picks the line. `release.yml` triggers on pushes to `main` and publishes each product whose version has no release tag yet. `pnpm release:publish` builds a commit of `origin/main`, beta or stable.
- **Guards.** The ancestry check, the all-apps gate and the mixed-version gate existed only to keep two branches in order, and are removed. These guards stay, each for its own reason:
  - The version picker hides `patch` and `prepatch` for a pre-release current version: those bumps do not follow from a pre-release.
  - `pnpm release` starts from the tip of `origin/main` with a clean tree: a stale branch bumps a stale version.
  - The source release tag is the gate of a publish (ADR 0096): a re-run skips what is done.
  - The hotfix guard below.
- **Stable hotfix.** When `main` holds unfinished work and a stable patch must ship, the fix goes on a local branch cut from the latest stable release tag. That branch takes a patch version commit, passes `pnpm verify --release`, and publishes with `pnpm release:publish` from that commit. `release:publish` accepts a commit that `origin/main` lacks for a stable version only, when the version is greater than the latest stable release and a patch of it, and HEAD descends from that release's tag. The hotfix commits reach `aidenlx/zotlit-repo` through the release tag alone. The fix lands on `main` separately through `pnpm land`, with the hotfix version added to the root `versions.json`.
- **Docs sites.** A push to `main` deploys Pre-release Docs (the `beta` wrangler environment, zotlit-beta.aidenlx.site). The production site (zotlit.aidenlx.site) deploys from the commit of a stable release: `release.yml` calls `docs-deploy.yml` with the release tag after it publishes a stable version, and a `workflow_dispatch` takes a site and a ref (for production, the default is the latest stable release tag). A push never deploys the production site. Both sites link to `main` to edit a page.

## Considered options

- **Keep `main` and `next`, with graduation as a fast-forward (ADR 0096).** It works, but every rule that it needs (graduation, hotfix land, merge path, ancestry) exists only for the second branch, and the publish repository already holds the stable state.
- **A long-lived stable branch for hotfixes.** It is the same second branch under another name. A hotfix is rare, and a local branch from the release tag is enough.
- **Push the hotfix branch to `aidenlx/zotlit-repo`.** It would let CI publish the hotfix, but the user's rule is that `main` is the only branch on the source repository. The release tag keeps the commits reachable.
- **Production docs from each push to `main`.** The trunk holds unreleased work, so the production site would describe features that stable users do not have.

## Consequences

- A stable hotfix publishes from a machine, not from `release.yml`. The npm package of a hotfix has no provenance statement, and the lead deploys its production docs with a dispatch.
- The version commit of a hotfix is not on `main`. The next stable release on `main` must have a greater version than the hotfix.
- The first production docs deploy under this rule happens at the next stable release. Until then the production site keeps what the old `main` deployed.
- The Land Queue state is in one `queue/` directory, and land logs no longer carry a branch name.
