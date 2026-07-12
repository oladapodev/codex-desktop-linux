"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  ISSUE_MARKER,
  compareCommits,
  dashboardBody,
  formatPreviewNotes,
  formatStableNotes,
  latestStableUpstreamSha,
  previewTag,
  previewTagsToDelete,
  pullNumbersFromCommits,
  reconcileMonitorIssue,
  selectPreviewCandidates,
  stableTag,
  staleClosedPreviewTags,
} = require("./upstream-release-monitor.js");

const sha = (character) => character.repeat(40);

function pull(number, headSha, overrides = {}) {
  return {
    number,
    state: "open",
    draft: false,
    title: `Change ${number}`,
    html_url: `https://github.com/upstream/repo/pull/${number}`,
    updated_at: `2026-07-${String(number).padStart(2, "0")}T12:00:00Z`,
    user: { login: `author${number}` },
    head: { sha: headSha },
    base: { sha: sha("f") },
    ...overrides,
  };
}

function release(tagName, assetCount = 1, overrides = {}) {
  return {
    tag_name: tagName,
    html_url: `https://github.com/fork/repo/releases/tag/${tagName}`,
    prerelease: tagName.startsWith("preview-pr-"),
    assets: Array.from({ length: assetCount }, (_, index) => ({ id: index + 1 })),
    ...overrides,
  };
}

test("builds deterministic preview and stable tags", () => {
  assert.equal(previewTag(42, sha("a")), "preview-pr-42-aaaaaaaaaaaa");
  assert.equal(
    stableTag("2026-07-12T08:55:23Z", sha("b")),
    "v2026.07.12.085523-bbbbbbbbbbbb",
  );
  assert.throws(() => previewTag(0, sha("a")), /positive integer/);
  assert.throws(() => previewTag(42, "short"), /40-character/);
  assert.throws(() => stableTag("not-a-date", sha("b")), /timestamp/);
});

test("selects at most four newest preview heads without existing releases", () => {
  const pulls = [1, 2, 3, 4, 5, 6].map((number) => pull(number, sha(String(number))));
  const releases = [release(previewTag(6, sha("6")))];

  const selected = selectPreviewCandidates({ pulls, releases, limit: 4 });

  assert.deepEqual(selected.map((item) => item.prNumber), [5, 4, 3, 2]);
  assert.equal(selected[0].tag, previewTag(5, sha("5")));
  assert.equal(selected[0].headSha, sha("5"));
  assert.equal(selected[0].baseSha, sha("f"));
});

test("manual selection targets one open PR and force rebuilds an existing tag", () => {
  const pulls = [pull(7, sha("a")), pull(8, sha("b"))];
  const releases = [release(previewTag(7, sha("a")))];

  assert.deepEqual(selectPreviewCandidates({
    pulls,
    releases,
    requestedPrNumber: 7,
    force: false,
  }), []);
  assert.equal(selectPreviewCandidates({
    pulls,
    releases,
    requestedPrNumber: 7,
    force: true,
  })[0].prNumber, 7);
  assert.throws(() => selectPreviewCandidates({
    pulls,
    releases,
    requestedPrNumber: 99,
  }), /not an open upstream PR/);
  assert.throws(() => selectPreviewCandidates({
    pulls,
    releases,
    force: true,
  }), /requires a requested PR number/);
});

test("uses the newest automated stable marker as the next release-note base", () => {
  const releases = [
    release("v-new", 1, { prerelease: false, published_at: "2026-07-12T12:00:00Z", body: `<!-- upstream-stable:${sha("b")} -->` }),
    release("v-old", 1, { prerelease: false, published_at: "2026-07-11T12:00:00Z", body: `<!-- upstream-stable:${sha("a")} -->` }),
    release("preview-pr-1-cccccccccccc", 1, { body: `<!-- upstream-stable:${sha("c")} -->` }),
  ];
  assert.equal(latestStableUpstreamSha(releases), sha("b"));
  assert.equal(latestStableUpstreamSha([release("manual", 1, { prerelease: false })]), null);
});

test("retention deletes older tags only for the same PR", () => {
  const releases = [
    release("preview-pr-12-aaaaaaaaaaaa"),
    release("preview-pr-12-bbbbbbbbbbbb"),
    release("preview-pr-13-cccccccccccc"),
    release("v2026.07.12.120000-dddddddddddd"),
  ];

  assert.deepEqual(
    previewTagsToDelete({ releases, prNumber: 12, keepTag: "preview-pr-12-bbbbbbbbbbbb" }),
    ["preview-pr-12-aaaaaaaaaaaa"],
  );
  assert.deepEqual(
    staleClosedPreviewTags({ releases, openPulls: [pull(12, sha("b"))] }),
    ["preview-pr-13-cccccccccccc"],
  );
});

test("preview notes clearly identify unmerged code and its commits", () => {
  const notes = formatPreviewNotes({
    upstreamRepository: "upstream/repo",
    pull: pull(21, sha("c"), { title: "Try a new feature", labels: [{ name: "feature" }] }),
    commits: [{
      sha: sha("d"),
      html_url: `https://github.com/upstream/repo/commit/${sha("d")}`,
      commit: { message: "Prototype feature\n\nDetails" },
      author: { login: "developer" },
    }],
    packageVersion: "2026.07.12.120000~preview.pr21.cccccccc",
    runUrl: "https://github.com/fork/repo/actions/runs/1",
  });

  assert.match(notes, /UNMERGED upstream code/);
  assert.match(notes, /Upstream PR: \[#21 Try a new feature\]/);
  assert.match(notes, /`cccccccccccccccccccccccccccccccccccccccc`/);
  assert.match(notes, /Prototype feature/);
  assert.match(notes, /Labels: `feature`/);
  assert.match(notes, /2026\.07\.12\.120000~preview\.pr21\.cccccccc/);
});

test("stable notes include merged PRs, commits, and provenance", () => {
  const notes = formatStableNotes({
    upstreamRepository: "upstream/repo",
    baseSha: sha("1"),
    headSha: sha("2"),
    forkSha: sha("3"),
    pulls: [{ number: 44, title: "Ship feature", html_url: "https://example.test/pr/44", user: { login: "dev" }, labels: [{ name: "enhancement" }] }],
    commits: [{
      sha: sha("2"),
      html_url: "https://example.test/commit/2",
      commit: { message: "Ship feature (#44)" },
      author: { login: "dev" },
    }],
    packageVersion: "2026.07.12.130000+22222222",
    runUrl: "https://github.com/fork/repo/actions/runs/2",
  });

  assert.match(notes, /Merged upstream pull requests/);
  assert.match(notes, /#44 Ship feature/);
  assert.match(notes, /labels: `enhancement`/);
  assert.match(notes, /Compare upstream changes/);
  assert.match(notes, new RegExp(sha("3")));
});

test("extracts unique PR numbers from squash and merge commit messages", () => {
  const commits = [
    { commit: { message: "Ship feature (#44)" } },
    { commit: { message: "Merge pull request #45 from example/branch" } },
    { commit: { message: "Follow up (#44)" } },
    { commit: { message: "Direct commit" } },
  ];
  assert.deepEqual(pullNumbersFromCommits(commits), [44, 45]);
});

test("paginates upstream comparisons beyond one hundred commits", async () => {
  const calls = [];
  const github = {
    rest: {
      repos: {
        compareCommitsWithBasehead: async ({ page }) => {
          calls.push(page);
          const count = page === 1 ? 100 : 1;
          return { data: { commits: Array.from({ length: count }, (_, index) => ({ page, index })) } };
        },
      },
    },
  };
  const commits = await compareCommits(github, { owner: "upstream", repo: "repo" }, sha("a"), sha("b"));
  assert.equal(commits.length, 101);
  assert.deepEqual(calls, [1, 2]);
});

function fakeGithub(initialIssues = []) {
  const calls = [];
  const issues = initialIssues.map((issue) => ({ ...issue }));
  const rest = { issues: {} };
  rest.issues.listForRepo = async () => ({ data: issues });
  rest.issues.getLabel = async () => ({ data: {} });
  rest.issues.createLabel = async (args) => { calls.push(["createLabel", args]); return { data: {} }; };
  rest.issues.create = async (args) => {
    calls.push(["create", args]);
    const created = { ...args, number: 100, state: "open" };
    issues.push(created);
    return { data: created };
  };
  rest.issues.update = async (args) => {
    calls.push(["update", args]);
    const issue = issues.find((item) => item.number === args.issue_number);
    if (issue) Object.assign(issue, args);
    return { data: issue };
  };
  return { github: { rest }, calls, issues };
}

test("dashboard escapes table content and reports ready, failed, and queued previews", () => {
  const pulls = [
    pull(1, sha("a"), { title: "Ready | feature" }),
    pull(2, sha("b")),
    pull(3, sha("c")),
  ];
  const releases = [
    release(previewTag(1, sha("a")), 1),
    release(previewTag(2, sha("b")), 0),
  ];
  const body = dashboardBody({
    upstreamRepository: "upstream/repo",
    upstreamHeadSha: sha("f"),
    stableRelease: null,
    pulls,
    releases,
    queuedCount: 1,
    runUrl: "https://example.test/run",
    stableResult: "skipped",
    previewResult: "success",
  });

  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.match(body, /Ready \\| feature/);
  assert.match(body, /ready/);
  assert.match(body, /failed/);
  assert.match(body, /queued/);
});

test("reconciliation creates an owned issue without touching an unowned labeled issue", async () => {
  const fixture = fakeGithub([{ number: 9, state: "open", body: "Maintainer notes" }]);
  const snapshot = {
    upstreamRepository: "upstream/repo",
    upstreamHeadSha: sha("f"),
    stableRelease: null,
    pulls: [],
    releases: [],
    queuedCount: 0,
    runUrl: "https://example.test/run",
    stableResult: "skipped",
    previewResult: "skipped",
  };

  const result = await reconcileMonitorIssue({
    github: fixture.github,
    repo: { owner: "fork", repo: "repo" },
    snapshot,
  });

  assert.equal(result.action, "created");
  assert.equal(fixture.calls.filter(([name]) => name === "create").length, 1);
  assert.equal(fixture.calls.some(([, args]) => args.issue_number === 9), false);
});

test("reconciliation updates the marked issue instead of creating duplicates", async () => {
  const fixture = fakeGithub([{ number: 11, state: "open", body: `${ISSUE_MARKER}\nOld status` }]);
  const result = await reconcileMonitorIssue({
    github: fixture.github,
    repo: { owner: "fork", repo: "repo" },
    snapshot: {
      upstreamRepository: "upstream/repo",
      upstreamHeadSha: sha("e"),
      stableRelease: null,
      pulls: [],
      releases: [],
      queuedCount: 0,
      runUrl: "https://example.test/run",
      stableResult: "success",
      previewResult: "success",
    },
  });

  assert.equal(result.action, "updated");
  assert.ok(fixture.calls.some(([name, args]) => name === "update" && args.issue_number === 11));
  assert.equal(fixture.calls.filter(([name]) => name === "create").length, 0);
});

test("reconciliation falls back to a dashboard body when Issues are disabled", async () => {
  const fixture = fakeGithub();
  fixture.github.rest.issues.create = async () => {
    const error = new Error("Issues has been disabled in this repository.");
    error.status = 410;
    throw error;
  };
  const result = await reconcileMonitorIssue({
    github: fixture.github,
    repo: { owner: "fork", repo: "repo" },
    snapshot: {
      upstreamRepository: "upstream/repo",
      upstreamHeadSha: sha("d"),
      stableRelease: null,
      pulls: [],
      releases: [],
      queuedCount: 0,
      runUrl: "https://example.test/run",
      stableResult: "success",
      previewResult: "success",
    },
  });

  assert.equal(result.action, "issues-disabled");
  assert.ok(result.body.startsWith(ISSUE_MARKER));
});

test("workflow keeps unmerged execution separate from write credentials", () => {
  const previewWorkflow = fs.readFileSync(
    ".github/workflows/upstream-preview-build.yml",
    "utf8",
  );
  const buildSection = previewWorkflow
    .split(/^  build-preview:/m)[1]
    .split(/^  publish-preview:/m)[0];
  assert.doesNotMatch(buildSection, /GH_TOKEN:/);
  assert.doesNotMatch(buildSection, /contents: write/);
  assert.doesNotMatch(buildSection, /actions\/checkout/);
  assert.match(buildSection, /actions\/cache\/restore@v4/);
  assert.doesNotMatch(buildSection, /actions\/cache@v4/);
  assert.match(previewWorkflow, /^permissions:\n  contents: write/m);
  assert.match(previewWorkflow, /^  publish-preview:[\s\S]*?contents: write/m);
  assert.match(previewWorkflow, /^  record-preview-failure:[\s\S]*?contents: write/m);
});

test("monitor polls four times hourly and bounds preview concurrency", () => {
  const monitorWorkflow = fs.readFileSync(
    ".github/workflows/upstream-release-monitor.yml",
    "utf8",
  );
  assert.match(monitorWorkflow, /cron: '7,22,37,52 \* \* \* \*'/);
  assert.match(monitorWorkflow, /PREVIEW_LIMIT: 4/);
  assert.match(monitorWorkflow, /max-parallel: 2/);
  assert.match(monitorWorkflow, /uses: \.\/\.github\/workflows\/upstream-preview-build\.yml/);
  assert.doesNotMatch(monitorWorkflow, /pull_request_target/);
  assert.match(monitorWorkflow, /--latest/);
});
