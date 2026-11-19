# CI setup

GitHub Actions uses the toolchain pinned in `mise.toml` and the pnpm version in
the root `package.json`. Repository workflows call the local
`.github/actions/setup-workspace` action, which restores both caches and then
runs `mise run init`. A call that passes `bootstrap: "false"`
keeps the toolchain and the caches and stops before the initializer.

1. The pnpm store cache is keyed from `pnpm-lock.yaml` by
   `pnpm/action-setup`.
2. The local Turborepo cache is restored from `.turbo` by `actions/cache`.

Each job writes a distinct Turbo cache entry. Restore prefixes first prefer the
same workflow and job, then allow compatible entries from other workflows on
the same runner operating system. Turbo task hashes remain the authority for
whether an individual result is reusable.

The setup action records the effective Node and pnpm versions in
`ZOTLIT_TOOLCHAIN`. The root Turbo configuration includes that value and
`mise.toml` in its global hash. A toolchain change therefore invalidates cached
tasks even when package source files are unchanged.

## Release workflow

The checks of a change run in `pnpm land`: it runs `pnpm verify` on the
rebased result before it pushes to `next`, and the Lefthook pre-push hook lets
only `pnpm land` push `next` and `main`
([ADR 0076](adr/0076-checks-run-before-push-and-ci-runs-only-to-release.md)).
`pnpm release` lands the version commit with the release gate.

`.github/workflows/release.yml` runs on every push to `main` and `next`, and on
manual dispatch. It publishes to the publish repository, `aidenlx/zotlit`
(`RELEASE_REPOSITORY`), and keeps its steps in `packages/scripts/lib/release/`:

| Job        | Runs                                                      | Credential                                                                                                         |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `plan`     | `release-plan.ts`: which products the pushed branch ships | none (reads the tags of `origin`)                                                                                  |
| `verify`   | `pnpm verify --release`, the desktop checks skipped       | none                                                                                                               |
| `obsidian` | `pnpm release:publish obsidian`                           | npm trusted publishing (`id-token: write`), `RELEASE_REPO_TOKEN`, `GITHUB_TOKEN` (`contents: write`, the tag here) |
| `zotero`   | `pnpm release:publish zotero`, then the attestation       | `RELEASE_REPO_TOKEN`, `GITHUB_TOKEN` (`contents: write`, attestations)                                             |

The `plan` job installs no dependencies. A product publishes when its version
is on the line of the pushed branch (a pre-release on `next`, a stable version
on `main`) and `aidenlx/zotlit-repo` has no release tag for it. That tag is the
last step of each publish, so a run that failed half way publishes again, and
each earlier step skips what is done. Workflow permissions are read-only; each
publish job grants itself the write permissions it needs.

The `obsidian` job pushes the shell commit and the version tag to
`aidenlx/zotlit` with `RELEASE_REPO_TOKEN`. A tag pushed with a token, not with
that repository's own `GITHUB_TOKEN`, starts the shell's `plugin-release.yml` there,
which runs with its own `GITHUB_TOKEN`: the official Obsidian action
(`mode: release`, `strict: true`), the Resource Release `res-<version>`, an
anonymous download check, the attestation of the resources, and the release.

### The steps and a second run

| Step (obsidian) | Does                                                                | On a second run                                                 |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| build           | `turbo run build --filter=@zotlit/obsidian` with `DOCS_SITE_URL`    | builds again                                                    |
| pack            | `pnpm pack` of `apps/obsidian/dist/package/`                        | packs again                                                     |
| npm             | `npm publish <tgz> --access public --tag beta\|latest --provenance` | the version on npm with the same files: skip; other files: stop |
| registry        | waits until the registry serves the version (10 min)                | returns at once                                                 |
| shell           | generates the shell; `pnpm install --lockfile-only` (3 attempts)    | the same tree                                                   |
| check           | frozen install and build in a clean folder; byte compare            | checks again                                                    |
| commit          | the shell commit on `beta` (beta) or `main` (stable)                | the tag on the same tree: skip the push; on another tree: stop  |
| push            | `git push --atomic` of the branch and the tag                       | skipped when the tag exists                                     |
| source tag      | `git push origin <sha>:refs/tags/<version>`                         | the tag on this commit: skip; on another commit: stop           |

The first beta, and a beta after a stable release that `beta` lacks, takes the
tip of `main` as a second parent, so `beta` always moves as a fast-forward and
no push needs force. `main` of `aidenlx/zotlit` changes only at a stable
release, so the community directory reads the stable `manifest.json` there.

| Step (zotero)    | Does                                                                  | On a second run                                                |
| ---------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| build            | `turbo run build --filter=@zotlit/zotero`                             | builds again                                                   |
| release          | `gh release create zt-<v>` with the XPI                               | the release has the XPI: download it, so the manifests hash it |
| update manifests | download `update*.json` from `zotero-release`, `build-update-json.ts` | the same version is not newer: the manifests stay              |
| update channel   | `gh release edit` and `upload --clobber` on `zotero-release`          | uploads the same files                                         |
| source tag       | `git push origin <sha>:refs/tags/zt-<v>`                              | as for the plugin                                              |

`pnpm release:publish <product>` runs the same steps on a machine, with the npm
login and the Git and `gh` login (or `RELEASE_REPO_TOKEN`). Its `--dry-run`
packs into a local registry, commits into the bare clone
`.scratch/publish-remote.git` of `aidenlx/zotlit`, pushes no tag, and prints
the commands a real run executes.

## Docs deployment

`.github/workflows/docs-deploy.yml` deploys Stable Docs from `main` and
Pre-release Docs from `next`. Manual dispatch always deploys. For a push, the
gate job asks Turbo whether the push changed `@zotlit/docs` or its dependency
closure. An unavailable base commit, a force push, a change to the deploy
workflow or to the setup action, or a failed Turbo query deploys instead of
skipping.

The gate job checks out the full history, which the base-commit comparison
needs, and stops before dependency installation. The deploy job runs only when
the gate reports a deployment, and starts from its own checkout.

The deploy job installs
`@zotlit/docs` and its dependency closure with a pnpm filter, then runs
`turbo run build --filter=@zotlit/docs`. The workspace packages export their
source, so only the generate tasks the docs build reads run before it.

The docs build reads `GITHUB_SHA`, which GitHub Actions sets for every step and
which the build declares in its Turbo task hash. This keeps commit-pinned
generated URLs correct when an earlier `.turbo` directory is restored.

## Cloudflare configuration

The docs deployment needs these values in `aidenlx/zotlit-repo`, the repository
that runs it:

- Secret `CLOUDFLARE_API_TOKEN` — `wrangler deploy`
- Secret `CLOUDFLARE_ACCOUNT_ID` — `wrangler deploy` and the media upload
- Secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` — the S3 key pair of
  the media upload (`pnpm --filter @zotlit/docs upload:media`)
- Variable `CF_BEACON_TOKEN` — the production line's Web Analytics site token
- Variable `CF_BEACON_TOKEN_BETA` — the Pre-release Docs line's site token

The `GITHUB_TOKEN` Worker secret is configured separately for each Wrangler
environment with `wrangler secret put GITHUB_TOKEN`.

## Zotero release host

The release workflow expects a permanent prerelease named `zotero-release` in
the publish repository (`RELEASE_REPOSITORY` in
`packages/config/repositories.ts`). It exists, with `update.json` and
`update-beta.json` assets. The workflow downloads those files before it
updates a release channel, and a missing host fails the release before it
changes a channel.

## Settings outside the repository

Before the first release of the two-repository flow:

- [ ] **npm scope.** Create the npm organization of the scope in the bundle
      package's name (`PUBLISHED_PLUGINS` in
      `packages/scripts/lib/shell/plugins.ts`), or change that one value to a
      scope the lead owns. The lead logs in with `npm login` as its owner.
- [ ] **First npm publish** from the lead's machine
      (CONTRIBUTING.md "First release from the new flow"); a package must
      exist before trusted publishing can be set for it.
- [ ] **Trusted publishing**, after that first publish: on npmjs.com, package
      settings → Trusted publishing → GitHub Actions, organization or user
      `aidenlx`, repository `zotlit-repo`, workflow `release.yml`, no
      environment. Then set "Require two-factor authentication and disallow
      tokens" for the package. The workflow needs npm 11.5.1 or later; the
      Node of `mise.toml` brings it.
- [ ] **`RELEASE_REPO_TOKEN`**: the fine-grained token needs **Contents: read
      and write** and **Workflows: read and write** on `aidenlx/zotlit`. Git
      refuses a push of a commit that adds or changes
      `.github/workflows/*.yml` without the Workflows permission, and every
      shell commit carries the shell's `plugin-release.yml`. It also needs Metadata:
      read (always on).
- [ ] **Actions in `aidenlx/zotlit-repo`**: enable Actions; keep workflow
      permissions read-only (each job grants its own). `id-token: write` is
      granted in the job, which needs no repository setting.
- [ ] **Actions in `aidenlx/zotlit`**: Actions stay enabled for the shell's
      `plugin-release.yml`. Its old monorepo workflows run from the branch
      they are on: `Docs Deploy` and `Release` are disabled there
      (`gh workflow disable -R aidenlx/zotlit`), since a push to its old
      `next` would deploy the old docs. GitHub keeps that state by file
      path, so the shell's workflow has a path of its own; a shell workflow
      at `.github/workflows/release.yml` would be disabled with the old one. `Issue triage gate` runs on issues
      from the default branch until the first stable shell replaces `main`;
      keep or disable it by choice.
- [ ] **Branches of `aidenlx/zotlit`**: the default branch stays `main`. Its
      ruleset "no force push, no deletion" fits the flow, which pushes
      fast-forwards only. Leave `beta` without a ruleset, or give it the same
      one. Delete or archive the old `next` when it is no longer needed.
- [ ] **Directory pre-scan**: run the community directory's "Review branch"
      pre-scan on `beta` of `aidenlx/zotlit` after the first shell commit.

## Verification

For a CI cache change:

1. Run a clean docs build.
2. Run the same build again and confirm Turbo reports cache hits.
3. Confirm a changed `GITHUB_SHA` gives `@zotlit/docs#build` a different hash.
4. Record the GitHub Actions durations for checkout, setup, install, build, and
   the complete job before and after the change.

Hosted-runner durations are diagnostic data. They are not a fixed CI pass or
fail threshold.
