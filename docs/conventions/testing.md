# Convention: Testing

## Test Framework

All repos use **vitest**. No repo uses jest.

| Repo                   | Config             | Environment                     | Notes                                          |
| ---------------------- | ------------------ | ------------------------------- | ---------------------------------------------- |
| cli                    | `vitest.config.ts` | node                            | `src/**/*.spec.ts`, `tests/evals/**/*.spec.ts` |
| authkit-nextjs         | `vitest.config.ts` | node + jsdom (two projects)     | `**/*.spec.ts`, `**/*.spec.tsx`                |
| authkit-session        | `vitest.config.ts` | node                            | `src/**/*.spec.ts`, `tests/**/*.spec.ts`       |
| authkit-tanstack-start | `vitest.config.ts` | node + happy-dom (two projects) | server + client splits                         |
| skills                 | `vitest.config.ts` | node                            | `scripts/tests/**/*.spec.ts`                   |

All repos use `globals: true` (no explicit vitest imports in test files).

## File Naming

Tests are **co-located** with source files using the `.spec.ts` / `.spec.tsx` suffix.

```
src/session.ts
src/session.spec.ts
src/commands/organization.ts
src/commands/organization.spec.ts
```

No repo uses `.test.ts` naming. Use `.spec.ts` consistently.

## Coverage

Coverage is tracked via vitest's `v8` provider.

| Repo                   | Threshold                                            | Enforced?             |
| ---------------------- | ---------------------------------------------------- | --------------------- |
| authkit-nextjs         | 80% (branches, functions, lines, statements)         | Yes, in vitest config |
| authkit-session        | 80% (global: branches, functions, lines, statements) | Yes, in vitest config |
| authkit-tanstack-start | No threshold configured                              | No                    |
| cli                    | No threshold configured                              | No                    |
| skills                 | No threshold configured                              | No                    |

Target: **80% coverage** for library packages (authkit-\*). CLI and skills have no enforced threshold.

## What to Test

### Must Test

- Public API surface (all exported functions)
- Error paths and edge cases
- JSON mode output (CLI commands)
- Both authenticated and unauthenticated states (AuthKit packages)

### Test Patterns

**Mocking**: Manual mocks implementing interfaces. External deps (WorkOS API, fetch) are mocked.

**CLI commands**: Each command spec tests both human and JSON output modes. Example pattern from `src/commands/organization.spec.ts`.

**AuthKit packages**: Test session lifecycle -- creation, validation, refresh, expiry. Mock WorkOS SDK responses.

**Skills**: Eval framework tests in `scripts/tests/`. Test scorer logic, reporter output, diff tooling -- not the skills themselves (those use the eval runner).

## Running Tests

```bash
# All repos
pnpm test           # run once
pnpm test:watch     # watch mode (where available)

# Coverage
pnpm test:coverage  # authkit-session
```

## Multi-Environment Testing

`authkit-nextjs` and `authkit-tanstack-start` use vitest's `projects` feature to run server tests in `node` and client tests in `jsdom`/`happy-dom`:

```typescript
// vitest.config.ts (authkit-tanstack-start)
projects: [
  { test: { name: 'server', environment: 'node', include: ['src/server/**/*.spec.*'] } },
  { test: { name: 'client', environment: 'happy-dom', include: ['src/client/**/*.spec.*'] } },
];
```
