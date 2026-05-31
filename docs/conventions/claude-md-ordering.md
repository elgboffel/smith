# Convention: CLAUDE.md Ordering

## Rationale

LLM providers cache prompt prefixes. CLAUDE.md content is injected early in the system prompt, so its structure directly affects cache hit rates. Content that stays the same across sessions should appear at the top — this maximizes the stable prefix that can be cached. Volatile content (current issues, temporary workarounds) should appear at the bottom where changes don't invalidate the cached prefix.

## Ordering Rules

Structure CLAUDE.md files in target repos with sections in this order, from most stable to most volatile:

| Order | Section                    | Stability     | Example Content                                                     |
| ----- | -------------------------- | ------------- | ------------------------------------------------------------------- |
| 1     | Identity & Purpose         | Very stable   | "This is authkit-nextjs, a Next.js integration for WorkOS AuthKit." |
| 2     | Rules & Conventions        | Stable        | Commit format, coding standards, import conventions                 |
| 3     | Architecture               | Stable        | Module structure, key abstractions, data flow                       |
| 4     | Commands                   | Mostly stable | Build, test, lint, typecheck commands                               |
| 5     | Known Issues / Workarounds | Volatile      | "Cookie parsing broken on v2.1 — use workaround in #87"             |
| 6     | Temporary Notes            | Very volatile | "TODO: remove after next release", current sprint context           |

## Example

**Before** (mixed stability):

```markdown
# MyRepo

## Current Issues

- Deploy is broken on staging (fix in progress)

## About

MyRepo is a REST API for managing widgets.

## Commands

pnpm test && pnpm build

## Rules

- Use conventional commits
- All functions must have JSDoc
```

**After** (ordered by stability):

```markdown
# MyRepo

MyRepo is a REST API for managing widgets.

## Rules

- Use conventional commits
- All functions must have JSDoc

## Commands

pnpm test && pnpm build

## Current Issues

- Deploy is broken on staging (fix in progress)
```

The identity and rules sections rarely change, so they form a stable cached prefix. The "Current Issues" section changes frequently and sits at the bottom where updates don't invalidate the cache.

## Anti-patterns

- **"Current Issues" or "TODO" at the top.** These change often and invalidate the entire cached prefix when updated.
- **Mixing stable and volatile content in the same section.** A "Rules" section that also contains "temporary exception: skip lint for foo.ts" forces a cache miss whenever the exception is added or removed. Move exceptions to a separate volatile section at the bottom.
- **Frequently-edited command lists at the top.** If commands change often (e.g., feature-flag-gated scripts), put the stable core commands near the top and the volatile ones in a separate section lower down.
