# Architecture: WorkOS CLI

> `../cli/main/` | TypeScript | pnpm

## Overview

The CLI is an interactive installer and resource management tool. It uses an **adapter pattern** to decouple UI rendering from business logic, and an **event emitter** to communicate state changes from a central XState machine to whichever UI adapter is active.

## Core Architecture

```
bin.ts (yargs CLI entry)
  └─> run.ts → runWithCore()
        ├─ Selects adapter (CLI / Dashboard / Headless)
        ├─ Builds XState machine (installer-core.ts)
        ├─ Adapter subscribes to InstallerEventEmitter
        └─ Machine drives all state transitions
```

### Adapter Pattern

Three adapters implement `InstallerAdapter` (`src/lib/adapters/types.ts`):

| Adapter            | When selected      | File                                    |
| ------------------ | ------------------ | --------------------------------------- |
| `CLIAdapter`       | Interactive TTY    | `src/lib/adapters/cli-adapter.ts`       |
| `DashboardAdapter` | `--dashboard` flag | `src/lib/adapters/dashboard-adapter.ts` |
| `HeadlessAdapter`  | Non-TTY / CI       | `src/lib/adapters/headless-adapter.ts`  |

Selection logic in `src/lib/run-with-core.ts`:

- `isNonInteractiveEnvironment()` --> HeadlessAdapter
- `options.dashboard` --> DashboardAdapter
- else --> CLIAdapter

Each adapter must implement `start()` and `stop()`. Adapters are **event subscribers** -- they react to machine events, never control flow.

### InstallerEventEmitter

Typed event system in `src/lib/events.ts`. Key event groups:

- **State**: `state:enter`, `state:exit`
- **Auth**: `auth:checking`, `auth:success`, `device:started`, `device:success`
- **Detection**: `detection:start`, `detection:complete`
- **Agent**: `agent:start`, `agent:progress`, `agent:success`, `agent:failure`
- **Git**: `git:checking`, `branch:created`, `postinstall:commit:success`
- **Validation**: `validation:start`, `validation:complete`
- **I/O**: `prompt:request`/`response`, `confirm:request`/`response`

### OutputMode

Resolved once at startup in `src/utils/output.ts`:

| Priority | Condition            | Mode    |
| -------- | -------------------- | ------- |
| 1        | `--json` flag        | `json`  |
| 2        | `WORKOS_FORCE_TTY=1` | `human` |
| 3        | Non-TTY              | `json`  |
| 4        | Default              | `human` |

All output flows through `outputSuccess()`, `outputError()`, `outputTable()`, `outputJson()`.

## Command Structure

Commands live in `src/commands/{resource}.ts` with co-located `{resource}.spec.ts`.

Pattern (from `src/commands/organization.ts`):

1. Export handler functions (`runOrgCreate`, `runOrgList`, etc.)
2. Use `createWorkOSClient(apiKey)` for API calls
3. Use `outputSuccess()`/`outputJson()` for output
4. Use `createApiErrorHandler('Resource')` for errors

Registration: Commands are registered in `src/bin.ts` via yargs and mirrored in `src/utils/help-json.ts` for `--help --json` output. The `registerSubcommand()` helper (`src/utils/register-subcommand.ts`) auto-enriches usage strings with required args.

### Adding a New Command

1. Create `src/commands/{resource}.ts` + `{resource}.spec.ts`
2. Register in `src/bin.ts` (yargs command)
3. Add to `src/utils/help-json.ts` command registry
4. Include JSON mode in spec tests

## Framework Installer Structure

### Auto-Discovery Registry

`src/lib/registry.ts` scans `src/integrations/` for directories with an `index.ts` exporting `{ config, run }`.

Each integration module (`IntegrationModule`):

- `config: FrameworkConfig` -- metadata, detection rules, priority
- `run(options): Promise<string>` -- installer entry point

Current integrations in `src/integrations/`:
`dotnet`, `elixir`, `go`, `kotlin`, `nextjs`, `node`, `php`, `php-laravel`, `python`, `react`, `react-router`, `ruby`, `sveltekit`, `tanstack-start`, `vanilla-js`

### JS Framework Installers

Each JS framework has an agent file: `src/{framework}/{framework}-installer-agent.ts`

Example: `src/nextjs/nextjs-installer-agent.ts`

### Adding a New Framework

1. Create `src/integrations/{name}/index.ts` exporting `{ config, run }`
2. For JS frameworks, create `src/{name}/{name}-installer-agent.ts`
3. Detection auto-registers via registry scan -- no manual wiring needed

## Key Files

| File                        | Purpose                                          |
| --------------------------- | ------------------------------------------------ |
| `src/bin.ts`                | CLI entry, yargs setup, all command registration |
| `src/run.ts`                | Installer entry, builds options                  |
| `src/lib/run-with-core.ts`  | XState machine setup, adapter selection          |
| `src/lib/events.ts`         | `InstallerEventEmitter` + typed events           |
| `src/lib/installer-core.ts` | XState machine definition                        |
| `src/lib/registry.ts`       | Integration auto-discovery                       |
| `src/lib/adapters/types.ts` | `InstallerAdapter` interface                     |
| `src/utils/output.ts`       | OutputMode resolution + formatters               |
| `src/utils/help-json.ts`    | Machine-readable command tree                    |
| `src/cli.config.ts`         | Framework ports, model config, branding          |
| `src/lib/constants.ts`      | `Integration` type, known integrations           |

## Exit Codes

`0` success, `1` error, `2` cancelled, `4` auth required (follows `gh` CLI convention).
