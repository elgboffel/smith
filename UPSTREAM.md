# Upstream provenance

`smith` is a fork of [workos/case](https://github.com/workos/case).

- **Forked from:** `workos/case` @ `7959ac917cdeb0983b4aaa20bb9f42021747fed8` (2026-05-19)
- **Vendored:** 2026-05-31 (snapshot, not a git remote — upstream history stripped)

## Why a fork

Case is coupled to GitHub/Linear issue fetching, `gh`-based PR creation, and a
central WorkOS `projects.json`. `smith` decouples it into a reusable, local-first
harness that:

- reads issues from local `.md` files (not GitHub/Linear)
- commits only — never opens PRs, never pushes, no `gh` dependency
- owns all state in the harness repo (learnings/proposals/projects committed),
  keyed by project, so worktrees share memory and target repos stay clean
- adds a human-gated promotion path (`smith promote`) from tactical learnings to
  durable target-repo docs

See the PRD under the issue tracker for the full design.

## Pulling upstream updates

Snapshot fork by design (heavy divergence intended). To pull a specific upstream
change: diff against `workos/case` at the relevant commit and cherry-pick into
`src/`. The local divergence is concentrated in ~6 seams:

- `src/entry/repo-detector.ts` — cwd toplevel as workspace
- `src/entry/issue-fetcher.ts` — local-md source
- `src/phases/close.ts` + `agents/closer.md` — commit-only, no PR
- learnings path resolver — harness-owned, project-keyed
- `projects.schema.json` — per-repo files, new fields (learningsKey, output, notify, promoteTo)
- `src/commands/promote.ts` (net-new) + retrospective hit-counting
