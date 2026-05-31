# Convention: Commits

## Format

All repos use [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | When to use                             |
| ---------- | --------------------------------------- |
| `feat`     | New feature or capability               |
| `fix`      | Bug fix                                 |
| `chore`    | Maintenance, deps, CI, tooling          |
| `refactor` | Code restructuring (no behavior change) |
| `docs`     | Documentation only                      |
| `test`     | Test additions or fixes                 |

### Breaking Changes

Use `!` suffix: `feat!: remove legacy auth flow`

This triggers a major version bump in release-please.

## Release-Please

The CLI repo (`../cli/main`) uses [release-please](https://github.com/googleapis/release-please) for automated releases:

- Config: `../cli/main/release-please-config.json`
- Manifest: `../cli/main/.release-please-manifest.json`
- Release type: `node`
- `bump-minor-pre-major: true` (pre-1.0, features bump minor)
- Changelog auto-generated from conventional commit messages

Other repos (`authkit-session`, `authkit-tanstack-start`) use manual versioning but still follow conventional commits for changelog consistency.

## Scopes

Scopes are optional but useful for multi-concern repos:

| Repo                   | Common scopes                                  |
| ---------------------- | ---------------------------------------------- |
| cli                    | `(main)` (release-please tag), framework names |
| authkit-nextjs         | `(deps)` for dependency updates                |
| authkit-tanstack-start | `(deps)`, `(readme)`                           |
| authkit-session        | none observed                                  |
| skills                 | none observed                                  |

## Examples from Repo History

```
feat!: move login/logout to auth subcommand, add auth status
fix: improve TanStack Start skill to reduce first-attempt build failures
chore(main): release 0.9.0
chore(deps): update TanStack dependencies to 1.154.8
docs: fix package name references in documentation
refactor: move examples to examples/next and examples/vinext
```

## Guidelines

- Keep the subject line under 72 characters
- Use imperative mood ("add feature" not "added feature")
- The body should explain **why**, not **what** (the diff shows what)
- One logical change per commit
- Squash fixup commits before merge
