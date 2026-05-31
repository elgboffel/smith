# Case

<img width="500" height="500" alt="Case" src="docs/case-logo.svg" />

Case is the reliability layer for agent-authored pull requests.

Its job is narrow: turn a clearly scoped task into a reviewed PR with evidence, and make the next run better when this one fails. Case is not a generic agent platform, a dashboard product, or a place to accumulate every possible workflow idea. Humans steer. Agents execute. The harness keeps the work reviewable.

## Why It Exists

Agents are useful when the surrounding system makes good work easier than bad work. Case provides that surrounding system:

- A shared map of target repos, commands, architecture notes, and conventions.
- A task format that separates human intent from machine-updated state.
- A small multi-agent pipeline with isolated responsibilities.
- Evidence gates for tests, manual verification, review, and PR creation.
- Retrospective learning so repeated failures become docs, playbooks, or enforcement.

The north star:

> Case exists to make agent-authored PRs reliable, reviewable, and self-improving.

## Core Loop

From a target repo:

```bash
smith 1234
```

Case detects the repo, fetches the GitHub issue, creates task files, runs a baseline check, and dispatches the pipeline:

```text
scout -> implementer -> verifier -> reviewer -> closer -> retrospective
```

For unclear work, use the human steering path:

```bash
smith --agent
smith --agent 1234
```

`smith --agent` starts an interactive orchestrator session. It can inspect context, fetch issues, help shape the task, create the task file, and then run the pipeline. It should not implement directly. This is the primary interface for “humans steer.”

For an existing task file:

```bash
smith run --task .smith/tasks/active/cli-1-issue-53.task.json
```

To resume an interrupted issue run, re-run the same command:

```bash
smith 1234
```

Case reuses the existing task when it finds one and resumes from stored state.

## What Belongs

Case should stay focused on the PR loop. A feature belongs when it does at least one of these:

- Makes `smith <issue>` or `smith --agent <issue>` more likely to produce a correct PR.
- Converts an observed agent failure into a repeatable guardrail.
- Preserves context isolation, evidence, or resumability.
- Can be tested hermetically without depending on one user's machine.

Current non-goals:

- Generic agent platform features.
- Local dashboards and webhook services.
- Human approval browser UI between pipeline phases.
- Specialized reviewer fleets.
- Ideation/spec execution as a first-class runtime.

Those ideas may be revisited only after the core PR loop is boringly reliable.

## Setup

Requires [Bun](https://bun.sh) >= 1.0.

```bash
bun install
bun link
smith init
```

`smith init` creates `~/.config/smith/` and migrates local state from the repo when run from the case checkout. Re-running it is safe.

Build a standalone binary:

```bash
bun run build:binary
cp dist/smith /usr/local/bin/smith
```

`build:binary` regenerates the embedded package asset manifest before compiling. The resulting `dist/smith` is portable: agent prompts, docs, playbooks, and AST rules are bundled into the executable.

## CLI

Primary commands:

```bash
smith 1234                 # create or resume a GitHub issue run
smith DX-1234              # create or resume a Linear issue run
smith --agent              # interactive steering session
smith --agent 1234         # steering session with issue context
smith onboard <path>                    # add a repo to projects.json
smith onboard <path> --interview        # add a repo with an interactive interview
smith onboard <repo> --re-interview     # re-interview an already-onboarded repo
smith run --task <file>    # run an existing task JSON
smith watch <task-slug>    # live-tail the event log
```

Agent-facing commands:

```bash
smith session <repo-path> --task <task.json>
smith status <task.json> [field value...]
smith mark-tested
smith mark-manual-tested
smith mark-reviewed --critical 0
smith update-memory --state "..." --approach "..." --file <path>
smith upload <file>
smith snapshot <agent-name>
smith create --repo <name> --title <title> --description <text> --evidence <expectations>
smith analyze-failure <task.json> <agent> <error>
smith bootstrap <repo>
smith check [--repo <repo>]
```

Common flags:

```bash
smith --model claude-opus-4-5 1234
smith run --task <file> --mode unattended
smith run --task <file> --dry-run
smith run --fresh 1234
```

## Storage Layout

Package-level config lives under `~/.config/smith/`. Per-repo runtime state lives under each target repo's ignored `.smith/` directory:

```text
~/.config/smith/
  config.json
  projects.json
  agent-versions/

<target-repo>/.smith/
  active
  learnings.md
  amendments/
  run-log.jsonl
  tasks/
    active/
      <task-slug>.md
      <task-slug>.task.json
  <task-slug>/
    events/
    plan.json
    working-memory.json
```

Override the config/cache directory with:

```bash
SMITH_DATA_DIR=/tmp/case-test smith init
```

Static package assets are versioned with Case and embedded into the standalone binary: `agents/`, markdown under `docs/`, and text rules under `ast-rules/`. When running from a checkout, disk files win so local prompt/doc edits are picked up immediately; set `SMITH_PACKAGE_ROOT=/path/to/case` to force a specific checkout as the disk override.

Each entry in `projects.json` may optionally include `credentials` (per-repo secrets needed for verification) and `verificationNotes` (free-form context the verifier should know about the repo).

For portable binary installs, keep `projects.json` in `~/.config/smith/` via `smith init --projects <path>` or `smith init --migrate-from <case-checkout>`. Repo paths in a portable `projects.json` should be absolute or relative to that `projects.json` file.

## Pipeline

The runtime uses a deterministic TypeScript pipeline executor for phase transitions. The LLMs do the work inside each phase; TypeScript decides which phase runs next.

Profiles:

- `standard`: scout, implement, verify, review, close, retrospective.
- `tiny`: implement, review, close, retrospective. Use only for docs, typos, and mechanical config changes where independent verification is not useful.

Revision loops are evaluator-driven. A verifier or reviewer rubric failure can send structured feedback back to the implementer. The default revision budget is two cycles. If consecutive cycles produce identical failure fingerprints (SHA-256 of failed categories + error summary), the pipeline aborts early instead of burning the remaining budget.

Every run writes an append-only event log under `<target-repo>/.smith/<task-slug>/events/`. `smith watch <task-slug>` renders those events while a run is active.

Every task carries `evidenceExpectations` — the concrete artifacts the verifier must produce. The orchestrator writes these based on the target repo's `evidenceStrategy` so the verifier knows what counts as proof up front.

## Agent Roles

| Agent         | Responsibility                                                       | Does Not Do                         |
| ------------- | -------------------------------------------------------------------- | ----------------------------------- |
| Orchestrator¹ | Parses issues, creates tasks, runs baseline, dispatches the pipeline | Implement code                      |
| Scout         | Explores the target repo read-only and returns structured findings   | Edit code, write files              |
| Implementer   | Writes the fix, runs automated tests, commits                        | Manual browser testing, PR creation |
| Verifier      | Tests the specific user-facing scenario and records evidence         | Edit code                           |
| Reviewer      | Reviews the diff against golden principles and conventions           | Edit code or create PRs             |
| Closer        | Creates the PR after evidence gates pass                             | Implement or test                   |
| Retrospective | Records learnings and proposes harness improvements                  | Edit target repo code               |

¹ The orchestrator runs as an LLM agent session via `smith --agent`, or as TypeScript runtime code for direct `smith <issue>` dispatch.

The key boundary is context isolation. Scout context is read-only exploration of the target repo; its structured findings (relevant files, patterns, test baseline) are synthesized by the orchestrator and injected into the implementer's prompt. Implementer context includes task details, playbooks, repo learnings, scout findings, and revision feedback. Verifier context is intentionally fresher. Reviewer context is focused on the diff and principles.

## Evidence Gates

Evidence markers live under the target repo's `.smith/<task-slug>/` directory:

- `tested`: created by `smith mark-tested` from real test output.
- `manual-tested`: created by `smith mark-manual-tested` from manual/browser verification evidence.
- `reviewed`: created by `smith mark-reviewed --critical 0`.

The closer checks these markers before opening a PR. The point is not ceremony; it is making the PR auditable without trusting a chat transcript.

Each repo declares an `evidenceStrategy` in `projects.json` that drives what the verifier produces:

- `ui-screenshot`: Playwright before/after screenshots for user-facing UI changes.
- `scenario-script`: a consumer script that exercises the specific user-facing scenario.
- `test-output`: automated test output only (for libraries and non-UI code).

## Self-Improvement

After a run, the retrospective agent should leave the harness smarter:

- Append tactical repo learnings under `<target-repo>/.smith/learnings.md`.
- Propose broader harness changes under `<target-repo>/.smith/amendments/`.
- Escalate repeated failures into docs, playbooks, conventions, or enforcement.

Retrospective output is constrained. It should not expand the product surface by default. The fix for repeated agent failure is usually a clearer task, a better playbook, a sharper convention, or a mechanical guardrail.

## Model Configuration

Configure models in `~/.config/smith/config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/workos/case/main/config.schema.json",
  "models": {
    "default": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" },
    "reviewer": { "provider": "google", "model": "gemini-2.5-pro" },
    "verifier": null
  }
}
```

Priority:

```text
--model flag > explicit spawn options > config file > hardcoded default
```

## Repository Map

Target repos are listed in `~/.config/smith/projects.json` (created by `smith init` + `smith onboard`). The schema is `projects.schema.json` in this repo.

Add a repo with:

```bash
smith onboard <path>                    # mechanical probe only
smith onboard <path> --interview        # mechanical probe + interactive interview
smith onboard <repo> --re-interview     # update an existing entry by re-interviewing
```

`--interview` runs the interviewer agent after the mechanical probe to capture evidence strategy rationale, verification notes, conventions, and repo-specific learnings. The interview writes the seed `.smith/learnings.md` and `CLAUDE.local.md` alongside the `projects.json` entry. `--re-interview` re-runs the interview for an existing repo and replaces its `projects.json` entry in place.

Then add any needed architecture notes under `docs/architecture/` and verify with:

```bash
smith check --repo <name>
```

## Development Checks

For case itself:

```bash
bun run typecheck
bun test ./src/__tests__/
bun run lint
bun run format:check
```

For target repos:

```bash
smith bootstrap <repo>
smith check --repo <repo>
```

## Philosophy

The short version:

- Humans steer. Agents execute.
- The harness is the product; target repo code is the output.
- When agents struggle, fix the harness.
- Enforce mechanically, not rhetorically.
- Test the specific fix, not the happy path.
- Keep the tool small unless reliability demands complexity.

See [docs/philosophy.md](docs/philosophy.md) for the fuller version.
