# Upstream Release Monitor Implementation Plan

> [!NOTE]
> This document may not reflect the current implementation.
> See the final report for up-to-date state:
> [Final Report](../reports/upstream-release-monitor.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically publish isolated preview packages for detected upstream PR heads and stable latest releases for upstream `main` changes, with detailed notes and a persistent activity dashboard.

**Architecture:** A tested CommonJS module owns discovery, naming, notes, retention selection, and issue formatting. A scheduled orchestration workflow handles trusted discovery and stable sync/release, while a reusable workflow separates credential-free PR execution from trusted preview publication.

**Tech Stack:** GitHub Actions, `actions/github-script`, Node.js 24 CommonJS, GitHub REST API, Bash, Debian packaging tools.

---

### Task 1: Tested monitor domain logic

**Covers:** [S1, S2, S3, S6, S7]

**Files:**
- Create: `scripts/ci/upstream-release-monitor.test.js`
- Create: `scripts/ci/upstream-release-monitor.js`

- [ ] **Step 1: Write failing tests for deterministic naming and candidate selection**

  Cover `previewTag(42, sha)`, `stableTag(date, sha)`, existing-release suppression, a four-item queue limit, explicit PR selection, and force rebuilding.

- [ ] **Step 2: Run the focused test and confirm the module is missing**

  Run: `node --test scripts/ci/upstream-release-monitor.test.js`

  Expected: failure because `upstream-release-monitor.js` does not exist.

- [ ] **Step 3: Implement naming, validation, release lookup, and preview selection**

  Export `previewTag`, `stableTag`, `selectPreviewCandidates`, `listOpenPulls`, and `listReleases`. Reject malformed PR numbers and non-40-character SHAs before producing workflow outputs.

- [ ] **Step 4: Add failing formatter and issue-ownership tests**

  Test preview warnings, stable PR/commit sections, Markdown table escaping, hidden issue marker ownership, and refusal to mutate an unowned issue.

- [ ] **Step 5: Implement notes and dashboard reconciliation**

  Export `formatPreviewNotes`, `formatStableNotes`, `dashboardBody`, and `reconcileMonitorIssue`. Use the existing `upstream-dmg-issue.js` fake-Octokit testing style.

- [ ] **Step 6: Run the focused tests**

  Run: `node --test scripts/ci/upstream-release-monitor.test.js`

  Expected: all monitor tests pass.

### Task 2: Isolated preview build workflow

**Covers:** [S2, S4, S6, S7]

**Files:**
- Create: `.github/workflows/upstream-preview-build.yml`

- [ ] **Step 1: Define typed reusable-workflow inputs**

  Accept `pr_number`, `head_sha`, `preview_tag`, `upstream_repository`, and `force`. Set workflow-level permissions to `contents: read` and use a per-PR concurrency key.

- [ ] **Step 2: Add the credential-free build job**

  Fetch `refs/pull/<number>/head` from the public URL, verify `HEAD` equals `head_sha`, install the same dependencies as `release.yml`, and run:

  ```bash
  make build-app
  make deb PACKAGE_VERSION="$package_version"
  ```

  Require exactly one `dist/codex-desktop_*.deb`, copy it to a workflow-controlled filename, validate size and Debian metadata, and upload it with one-day retention.

- [ ] **Step 3: Add trusted success publication**

  In a separate `contents: write` job, check out the trusted fork workflow commit, download the known artifact, regenerate trusted PR release notes, replace the same deterministic tag only when `force` is true, create a prerelease, and delete older `preview-pr-<number>-*` releases after success.

- [ ] **Step 4: Add trusted failure publication**

  On build failure, create or update an asset-free prerelease at the deterministic preview tag with the source SHA and workflow-run URL. Do not delete the previous successful preview asset.

### Task 3: Upstream discovery, stable release, and dashboard workflow

**Covers:** [S3, S5, S6, S7]

**Files:**
- Create: `.github/workflows/upstream-release-monitor.yml`

- [ ] **Step 1: Add schedule, manual inputs, concurrency, and read-only discovery**

  Schedule `7,22,37,52 * * * *`. Add optional `pr_number` and boolean `force_preview` inputs. Fetch upstream `main`, compute merge-base/head, query releases and open PRs through the tested module, and emit a maximum-four preview matrix.

- [ ] **Step 2: Call the preview workflow through a bounded matrix**

  Use `strategy.max-parallel: 2` and pass only validated PR number, SHA, deterministic tag, repository, and force inputs to `upstream-preview-build.yml`.

- [ ] **Step 3: Add trusted stable synchronization**

  When the deterministic stable release is missing, fetch the exact upstream SHA, merge without force, push `HEAD:main`, and expose the resulting fork SHA. Re-fetch origin immediately before pushing so concurrent maintainer changes fail safely.

- [ ] **Step 4: Add read-only stable build and trusted publication**

  Build the exact synced fork SHA with a stable `PACKAGE_VERSION`, validate and upload the Debian package, then generate notes, create the deterministic tag at that SHA, publish a non-prerelease marked latest, and retain all stable releases.

- [ ] **Step 5: Reconcile the managed activity issue**

  Run with `if: always()` after discovery, previews, and stable jobs. Query current upstream PRs/releases and update only the issue carrying `<!-- upstream-release-monitor -->`.

### Task 4: Documentation and validation

**Covers:** [S8]

**Files:**
- Create: `docs/upstream-release-monitor.md`
- Modify: `README.md`

- [ ] **Step 1: Document operation and trust boundaries**

  Explain polling cadence, preview/stable tag formats, prerelease semantics, package versions, latest-only preview retention, failure markers, manual force rebuilds, and schedule disabling.

- [ ] **Step 2: Run JavaScript and shell validation**

  Run:

  ```bash
  node --check scripts/ci/upstream-release-monitor.js
  node --test scripts/ci/upstream-release-monitor.test.js
  bash scripts/ci/run-node-checks.sh
  bash -n scripts/lib/*.sh
  ```

  Expected: all commands exit zero.

- [ ] **Step 3: Validate workflow YAML and inspect the final diff**

  Run `actionlint` when available, parse both files with a YAML parser, verify no write token exists in an untrusted build job, and run `git diff --check`.

- [ ] **Step 4: Commit, push, and verify the first manual monitor run**

  Push the implementation to `main`, dispatch `upstream-release-monitor.yml`, and confirm discovery, preview, stable, and dashboard results through GitHub Actions. Do not report completion until the first run is visible and its result is known.
