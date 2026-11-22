---
status: superseded in part by ADR-0102
---

# main is the one trunk

> **Superseded in part by [ADR 0102](0102-each-land-opens-a-record-pull-request.md).** A land pushes its task branch to `aidenlx/zotlit-repo` as the head of its record pull request, and deletes it once the PR shows as merged. `main` stays the one long-lived branch.
>
> [ADR 0115](0115-the-end-to-end-run-runs-in-a-container-of-its-own.md) retires the End-to-end Run after each land.

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

## Docs deployment inputs and gate

`docs-deploy.yml` deploys the pre-release site from an affected push to
main, using the Wrangler `beta` environment for the build and deploy.
The release workflow calls it for production after a stable publish.
A manual production deploy without a ref uses the latest stable tag.
Each site serializes its deployments and cancels superseded runs so an
older run cannot overwrite newer pages.

The push gate compares the whole dependency closure of the docs against
the push base. It needs full history and the pinned tools but can skip
workspace installation before it decides. It deploys when the base is
unavailable, history was rewritten, the deploy setup changed, or the
Turbo dry run fails. The root message catalogs and their Inlang project
also trigger deploys because they live outside the package closure.
Calls and dispatches always deploy.

The build checks out history for page dates and LFS objects for media.
It installs just the docs dependency closure. Cloudflare bindings and
the optional Web Analytics beacon token are build inputs selected per
site. The beta build must omit analytics when its own token is empty.
[Analytics token follow-up](https://github.com/aidenlx/zotlit-repo/issues/64)

The two sites share one R2 media bucket. The site build refers to each
recording by a content-hashed key and omits those videos from Worker
assets. A deploy uploads missing keys before it publishes the pages
that refer to them. The upload credentials are scoped to the bucket.

### Land Turn execution

Check that the task worktree is clean and on a branch before
joining the queue. Fetch, rebase, gate, and fast-forward push
within the Land Turn. Run the release gate for a version commit.
If the remote advances during the gate, fetch and repeat the
rebase and gate within the same turn. On a rebase conflict,
abort so the original task tree is available. Git can also refuse
before replay when an untracked file would be overwritten. A
failed gate or push leaves the rebased task tree available to fix.

The Land Queue uses the admission machinery without driving the
desktop or taking the Memory Gate. A dead holder can be replaced.
The pre-push hook checks the Land Turn token. Append wait
and outcome records and keep full command output in the land
log. Each gate command has its own process group so the end of
the Lease stops its workers too. Throttle progress writes while
leaving sufficient signals inside the silence limit. After a
successful push, update the local trunk when its worktree is
clean and retire the remote task branch. A dirty trunk worktree
does not change whether the push succeeded.

Prove the workflow with real Git against a temporary bare remote
and an injected gate. Drive a competing upstream push from
the gate to exercise the fetch and repeat path. A loaded machine
can expire a short test Lease before the gate's first line.
Assert the Lease outcome without requiring that first line.

[Land implementation](../../packages/scripts/lib/land.ts) ·
[Land Queue](../../packages/scripts/lib/land-queue.ts)

### Gate scope

The affected base is the merge base with `origin/main`. A stable hotfix therefore checks the changes on its local branch even when the hotfix starts from an older release tag. The format-only path applies to a branch that changes only agent documentation. Build inputs such as snapshots, fixture pages, and documentation site content use the regular gate.

### Release planning and version selection

Run release planning before installing dependencies. Keep the entry point and its two release modules independent of installed packages. Read version metadata from the checkout and source tags from the remote. Send decisions and the stable documentation tag to the workflow output and reasons to stderr. All products of a push tag its source commit, so any newly published stable product tag identifies the production documentation revision.

Preserve the prerelease identifier when proposing bumps and use `beta` for the first prerelease. Normalize valid explicit SemVer input. The version picker offers only eligible bumps and lets the maintainer enter an explicit version. When ZotLit and the Resource Pack release together, select ZotLit first so the interactive picker can constrain the pack to that line. Reject mixed lines for the combined release. Command-line version selections use the same checks and bypass the prompts.

Refresh the default Obsidian manifest and the compatibility maps only for stable releases. Shell generation consumes those stable files. After a successful Land Turn, return to the original branch and fast-forward it to the published tip. If the Land Turn fails, keep its diagnostic log and discard the local release branch. Require the local trunk and remote trunk tips to agree before selecting versions, so the release neither bumps stale versions nor carries unrelated local commits.
