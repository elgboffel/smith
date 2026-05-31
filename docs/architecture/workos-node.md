# Architecture: WorkOS Node SDK

> `../workos-node/main/` | TypeScript | npm
> Official WorkOS SDK for Node.js, Workers, and edge runtimes.

## Overview

`@workos-inc/node` is a modular, type-safe SDK covering 20+ WorkOS API domains. It uses a **dependency-injected module pattern** where each API domain is a class that receives the root `WorkOS` instance, and a **serializer layer** that converts between TypeScript camelCase and API snake_case. The SDK ships dual CJS/ESM bundles with a separate worker entry point for edge runtimes.

## Core Architecture

```
WorkOS (src/workos.ts)                      ← root client, holds HttpClient + config
  ├─ HttpClient (src/common/net/)           ← fetch-based, retry, timeout
  ├─ CryptoProvider (src/common/crypto/)    ← abstract crypto (HMAC, AES, PKCE)
  └─ Domain Modules (20+)                   ← each receives `this` (WorkOS instance)
       ├─ sso/
       ├─ user-management/
       ├─ directory-sync/
       ├─ organizations/
       ├─ webhooks/
       ├─ fga/
       └─ ...
```

### Client Construction

Three construction modes via `new WorkOS()` or `createWorkOS()` factory:

| Mode         | Input                              | Use case               |
| ------------ | ---------------------------------- | ---------------------- |
| API key only | `new WorkOS('sk_...')`             | Server-side            |
| Confidential | `new WorkOS({ apiKey, clientId })` | Server-side + OAuth    |
| Public/PKCE  | `new WorkOS({ clientId })`         | Client-side PKCE flows |

The factory (`src/factory.ts`) returns typed `PublicWorkOS` or full `WorkOS` depending on whether an API key is provided. Constructor reads `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` from env as fallback; the factory does not.

## Module Pattern

Each API domain follows a consistent structure:

```
[module]/
  ├─ [module].ts           # Class with API methods (receives WorkOS instance)
  ├─ [module].spec.ts      # Unit tests
  ├─ interfaces/           # TypeScript types (request/response)
  ├─ serializers/          # camelCase ↔ snake_case transformers
  └─ fixtures/             # Test response fixtures
```

Domains include: `sso`, `user-management`, `directory-sync`, `organizations`, `organization-domains`, `authorization`, `fga`, `webhooks`, `actions`, `passwordless`, `mfa`, `api-keys`, `audit-logs`, `events`, `feature-flags`, `portal`, `roles`, `vault`, `pipes`, `widgets`, `pkce`.

## HTTP Client

`src/common/net/` — fetch-based with retry logic.

| Class                   | Purpose                       |
| ----------------------- | ----------------------------- |
| `HttpClient` (abstract) | Interface for HTTP operations |
| `FetchHttpClient`       | Concrete fetch implementation |
| `HttpClientResponse`    | Response wrapper              |
| `HttpClientError`       | Typed error wrapper           |

**Retry behavior** (specific paths only: `/fga/*`, `/vault/*`, `/audit_logs/events`):

- Max 3 attempts, exponential backoff (1.5× multiplier, 500ms base, randomized jitter 0.5–1.5×)
- Retries on: `TypeError`, HTTP 408/500/502/504
- Default timeout: 60s per request (AbortController-based)

**WorkOS HTTP methods**: `get`, `post`, `put`, `patch`, `delete`, `deleteWithBody`. All validate API key presence unless `skipApiKeyCheck: true`.

Supports `Idempotency-Key` header on POST/PUT/PATCH for safe retries.

## Serialization

Dedicated serializer files per module. Pattern:

```typescript
// Request: camelCase → snake_case
const serializeListConnectionsOptions = (options) => ({
  ...(options.connectionType && { connection_type: options.connectionType }),
  ...(options.organizationId && { organization_id: options.organizationId }),
});

// Response: snake_case → camelCase
const deserializeProfile = (profile) => ({
  id: profile.id,
  idpId: profile.idp_id,
  organizationId: profile.organization_id,
  customAttributes: profile.custom_attributes,
});
```

Common serializers in `src/common/serializers/` handle pagination, events, and list envelopes.

## Pagination

`AutoPaginatable<T>` — async-generator-based cursor pagination.

- Cursor-based (`after`/`before`), configurable `limit` (default 100)
- Built-in 350ms delay between pages (respects 4 req/s rate limit)
- `.autoPagination()` collects all pages into a single array

## Error Handling

Exceptions in `src/common/exceptions/`. Most extend `Error` directly via `RequestException` interface (not a class hierarchy):

```
Error
  ├─ GenericServerException (catchall, implements RequestException)
  │    └─ RateLimitExceededException (429, adds retryAfter)
  ├─ NotFoundException (404)
  ├─ UnauthorizedException (401)
  ├─ BadRequestException (400)
  ├─ UnprocessableEntityException (422)
  ├─ ConflictException (409)
  ├─ OauthException
  ├─ ParseError (JSON parse failure, includes raw body + rawStatus)
  ├─ ApiKeyRequiredException (thrown when public client calls key-required method)
  ├─ NoApiKeyProvidedException (legacy)
  └─ SignatureVerificationException (webhook HMAC mismatch)
```

Request-related exceptions implement `RequestException` interface (`status`, `message`, `requestID`). Error dispatch lives in `WorkOS.handleHttpError()` (switch on status code).

## Crypto Abstraction

`src/common/crypto/` — abstracts crypto for cross-runtime support.

- `CryptoProvider` (abstract): HMAC, AES-256-GCM, random bytes
- `SubtleCryptoProvider`: Web Crypto API implementation
- Used for webhook signature verification and session encryption

## Multi-Runtime Support

Two entry points with conditional `package.json` exports:

| Entry   | File                  | Runtime                               |
| ------- | --------------------- | ------------------------------------- |
| Default | `src/index.ts`        | Node.js (uses `process` warnings)     |
| Worker  | `src/index.worker.ts` | Cloudflare Workers, Vercel Edge, Deno |

```json
"exports": {
  ".": {
    "workerd": "./lib/index.worker.mjs",
    "edge-light": "./lib/index.worker.mjs",
    "convex": "./lib/index.worker.cjs",
    "import": "./lib/index.mjs",
    "require": "./lib/index.cjs"
  },
  "./worker": { "import": "./lib/index.worker.mjs", "require": "./lib/index.worker.cjs" }
}
```

## Build & Test

**Build**: `tsdown` → outputs `.cjs`, `.mjs`, `.d.cts` to `lib/`. Inlines `jose`, `iron-webcrypto`, `uint8array-extras`.

**Test**: Jest with `jest-fetch-mock`. Per-module specs use helpers from `src/common/utils/test-utils.ts`:

- `fetchOnce(response)` — mock next fetch
- `fetchURL()`, `fetchBody()`, `fetchHeaders()`, `fetchSearchParams()` — assert request shape

**TypeScript**: ES2022 target, strict mode, bundler module resolution.

## Key Files

| File                             | Purpose                                        |
| -------------------------------- | ---------------------------------------------- |
| `src/index.ts`                   | Main exports (Node.js)                         |
| `src/index.worker.ts`            | Worker/edge exports                            |
| `src/workos.ts`                  | Root `WorkOS` class, HTTP methods, module init |
| `src/factory.ts`                 | Type-safe `createWorkOS()` factory             |
| `src/common/net/`                | HTTP client + retry logic                      |
| `src/common/crypto/`             | Crypto abstraction                             |
| `src/common/exceptions/`         | Error hierarchy                                |
| `src/common/serializers/`        | Shared serialization (pagination, lists)       |
| `src/common/utils/test-utils.ts` | Jest fetch mock helpers                        |
