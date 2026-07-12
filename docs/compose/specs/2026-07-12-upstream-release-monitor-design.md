# Upstream Release Monitor Design

## [S1] Goal

The fork must poll `ilysenko/codex-desktop-linux`, expose current upstream pull-request activity, build each newly detected open pull-request head for testing, and publish stable builds after upstream changes reach `main`. The automation must avoid rebuilding an unchanged source SHA and must never expose release credentials to code from an unmerged pull request.

## [S2] Release classes

Preview builds are GitHub prereleases named `[PREVIEW] Upstream PR #<number>` and tagged `preview-pr-<number>-<12-character-head-sha>`. Their Debian version is `YYYY.MM.DD.HHMMSS~preview.pr<number>.<8-character-head-sha>`, so the package is visibly experimental and a later stable timestamp supersedes it.

Stable builds are normal GitHub releases, are marked latest, and use a deterministic tag derived from the upstream commit timestamp and SHA: `vYYYY.MM.DD.HHMMSS-<12-character-upstream-sha>`. Their Debian version is `YYYY.MM.DD.HHMMSS+<8-character-upstream-sha>`.

## [S3] Discovery and scheduling

The monitor runs at minutes 7, 22, 37, and 52 of each hour and supports manual dispatch for a specific upstream PR. It queries all open upstream PRs and the fork's releases, then queues only PR head SHAs without an existing success or failure prerelease. At most four preview SHAs are selected per monitor run and at most two build concurrently, preventing an initial backlog from launching an unbounded number of large builds.

The current upstream `main` SHA is compared with the fork using `git merge-base`. A stable build is required when the deterministic stable release tag does not exist. If the fork does not yet contain that upstream SHA, a trusted sync job merges and pushes it before the stable build begins.

## [S4] Preview security boundary

An unmerged PR build fetches the exact `refs/pull/<number>/head` SHA from the public upstream repository without checking out fork credentials. It receives no repository secrets and has read-only job permissions. It may execute the PR's build scripts, but it cannot create tags, mutate issues, or publish releases.

The build job creates one Debian package, renames it to a workflow-controlled filename, verifies that it is a regular file within a bounded size, and uploads it as a short-lived Actions artifact. A separate trusted job downloads but never executes the package, verifies its Debian metadata, generates release notes from trusted workflow code and GitHub API data, and publishes it as a prerelease.

## [S5] Stable sync and publishing

The stable sync job performs only Git operations: fetch the exact upstream target, merge it without force-pushing, and push the resulting fork commit. The stable build job checks out that exact fork commit with read-only permissions, runs `make build-app` and `make deb`, validates the package, and uploads it as an Actions artifact. A separate trusted publisher creates the deterministic tag and stable GitHub release after the build succeeds.

Because pushes made with `GITHUB_TOKEN` do not start new push workflows, sync, build, tag, and release remain in one scheduled workflow run. Existing manual `release.yml` behavior remains available as a fallback.

## [S6] Release notes and activity dashboard

Preview notes identify the upstream PR, author, source SHA, commit list, upstream URL, build run, package version, and an explicit warning that the package contains unmerged code.

Stable notes identify the upstream comparison range, merged PR titles and authors inferred from commit messages and GitHub API data, every commit in the range, upstream and fork SHAs, build run, and package version.

One managed fork issue named `Upstream PR and release monitor` shows the upstream `main` SHA, latest stable release, workflow status, queued preview count, and a table of all open upstream PRs with their head SHA and preview state. A hidden ownership marker prevents the workflow from modifying maintainer-created issues.

## [S7] Retention and failures

After a new preview succeeds, the publisher deletes older preview releases and tags for the same PR. Closed or merged PR preview releases are removed by the monitor after a stable replacement is available. Stable releases are retained permanently.

If a preview build fails, a trusted failure job creates a prerelease with the deterministic preview tag and no package asset. Its notes link to the failed run, and discovery treats the SHA as handled. A manual dispatch can force that exact PR to rebuild. If stable sync or build fails, no stable release is created and the dashboard reports the failure; the next scheduled run retries the missing deterministic stable release.

## [S8] Validation and operation

Pure JavaScript helpers cover tag generation, preview selection, release-note formatting, issue ownership, and dashboard formatting with `node:test`. CI syntax checks include both workflow files and all shell blocks. Manual dispatch supports a PR number and force flag for recovery. The human documentation explains release naming, trust boundaries, retention, retry behavior, and how to disable the schedule.
