# Convention: Code Style

## TypeScript

**Strict mode**: All 5 repos have `"strict": true` in `tsconfig.json`. No exceptions.

Additional rules observed across repos:

- Use `import type` for type-only imports
- Prefer `unknown` over `any`; use type guards to narrow
- Explicit return types on public API functions
- Use `.js` extensions in relative imports (ESM resolution)

## Formatters

| Repo                   | Formatter | Command                                         | Config        |
| ---------------------- | --------- | ----------------------------------------------- | ------------- |
| cli                    | oxfmt     | `pnpm format`                                   | --            |
| authkit-nextjs         | prettier  | `pnpm format` / `pnpm prettier` (check)         | `.prettierrc` |
| authkit-session        | prettier  | `pnpm run format` / `pnpm run prettier` (check) | --            |
| authkit-tanstack-start | prettier  | `pnpm run format` / `pnpm run prettier` (check) | --            |
| skills                 | oxfmt     | `pnpm format`                                   | --            |

**Trend**: CLI and skills use **oxfmt** (Rust-based, fast). AuthKit packages use **prettier**. When in doubt, check the repo's `package.json` scripts.

Prettier settings (authkit-session):

```
trailingComma: 'all'
semi: true
arrowParens: 'avoid'
singleQuote: true
tabWidth: 2
```

## Linters

| Repo                   | Linter | Command         | Config           |
| ---------------------- | ------ | --------------- | ---------------- |
| cli                    | oxlint | `pnpm lint`     | `.oxlintrc.json` |
| authkit-nextjs         | eslint | `pnpm run lint` | `.eslintrc.cjs`  |
| authkit-session        | --     | --              | --               |
| authkit-tanstack-start | --     | --              | --               |
| skills                 | oxlint | `pnpm lint`     | `.oxlintrc.json` |

**Trend**: Newer repos (cli, skills) use **oxlint**. authkit-nextjs uses **eslint**. authkit-session and authkit-tanstack-start have no linter configured.

## File Size Guidance

Based on survey of actual file sizes across repos:

| Repo                   | Largest source file          | Lines |
| ---------------------- | ---------------------------- | ----- |
| cli                    | `src/bin.ts`                 | ~2016 |
| authkit-nextjs         | `src/session.ts`             | ~606  |
| authkit-session        | `src/service/AuthService.ts` | ~288  |
| authkit-tanstack-start | `src/client/tokenStore.ts`   | ~356  |

**Guideline**: Keep source files under **300 lines** where possible. The CLI's `bin.ts` (2000+ lines) is a known outlier; new commands should be in their own files, not added to `bin.ts`. Test files can be longer.

## Naming Conventions

### Files

- **PascalCase** for class files: `AuthKitCore.ts`, `TokenManager.ts`, `CookieSessionStorage.ts`
- **kebab-case** for module/utility files: `cli-adapter.ts`, `help-json.ts`, `env-parser.ts`
- **kebab-case** for command files: `organization.ts`, `feature-flag.ts`

### Code

- **PascalCase**: Classes, types, interfaces, enums
- **camelCase**: Functions, variables, methods
- **UPPER_SNAKE_CASE**: Environment variable names, true constants in config

### Test Files

- Co-located: `{name}.spec.ts` next to `{name}.ts`
- Never `.test.ts` -- always `.spec.ts`

## Package Manager

All repos use **pnpm**. No npm, no yarn.

## Import Ordering

Observed pattern (not enforced by tooling):

1. Node built-ins (`node:fs`, `node:path`)
2. External packages (`@workos-inc/node`, `jose`, `yargs`)
3. Internal modules (relative imports with `.js` extension)

## Module System

All repos target ESM. Relative imports use `.js` extensions:

```typescript
import { AuthKitCore } from './core/AuthKitCore.js';
```

authkit-session builds both CJS and ESM outputs for consumer compatibility.
