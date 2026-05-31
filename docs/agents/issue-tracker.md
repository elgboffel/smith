# Issue tracker: Local Markdown

smith dogfoods the local-md convention it implements. Issues and PRDs live as
markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is a `Status:` line near the top of each issue file
- Comments/history append to the bottom under a `## Comments` heading

This is the exact format smith's own `local-md` issue source parses:
H1 = title, full body = description, `Status:` line = triage/lifecycle gate.
