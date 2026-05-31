# Architecture: AuthKit Framework Integrations

> Canonical pattern for building AuthKit framework SDKs.
> Reference repos: `../authkit-nextjs/`, `../authkit-tanstack-start/`

## Overview

Each AuthKit framework integration follows a shared pattern:
**middleware --> session management --> provider --> hooks**

The key difference is how much of the session layer lives in `authkit-session` vs in the framework package itself. TanStack Start consumes `authkit-session` directly. Next.js predates it and has its own session implementation (convergence planned).

## Canonical Pattern

### 1. Middleware

Intercepts every request. Validates/refreshes the session cookie. Passes auth context downstream.

| Framework      | File                       | Mechanism                                          |
| -------------- | -------------------------- | -------------------------------------------------- |
| Next.js        | `src/middleware.ts`        | `authkitMiddleware()` returns `NextMiddleware`     |
| TanStack Start | `src/server/middleware.ts` | `authkitMiddleware()` returns `createMiddleware()` |

Both export a factory: `authkitMiddleware(options?) --> middleware function`

**TanStack Start** delegates to `authkit-session`'s `AuthService.withAuth()` inside the middleware, passing auth result via TanStack's `context` system.

**Next.js** calls its own `updateSessionMiddleware()` which handles JWT verification, token refresh, and cookie management inline.

### 2. Session Management

| Concern          | Next.js                                              | TanStack Start                                                                  |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Storage          | Own cookie logic (`src/cookie.ts`, `src/session.ts`) | Extends `CookieSessionStorage` from `authkit-session` (`src/server/storage.ts`) |
| Encryption       | `iron-session` directly                              | `authkit-session`'s `ironWebcryptoEncryption`                                   |
| JWT verification | Own JWKS fetch (`jose`)                              | `AuthKitCore.verifyToken()` via `authkit-session`                               |
| Token refresh    | Own refresh logic in `session.ts`                    | `AuthKitCore.refreshTokens()` via `authkit-session`                             |

**Key file (TanStack Start)**: `src/server/storage.ts` -- `TanStackStartCookieSessionStorage` extends `CookieSessionStorage<Request, Response>` from `authkit-session`, implementing `getSession()` and `applyHeaders()`.

### 3. Auth Helpers (Server-Side)

Both packages export server functions for auth operations:

| Function         | Next.js (`src/auth.ts`)                          | TanStack Start (`src/server/server-functions.ts`) |
| ---------------- | ------------------------------------------------ | ------------------------------------------------- |
| Get auth state   | `withAuth()`                                     | `getAuth()`                                       |
| Sign in URL      | `getSignInUrl()`                                 | `getSignInUrl()`                                  |
| Sign up URL      | `getSignUpUrl()`                                 | `getSignUpUrl()`                                  |
| Sign out         | `signOut()`                                      | `signOut()`                                       |
| Switch org       | `switchToOrganization()`                         | `switchToOrganization()`                          |
| Callback handler | `handleAuth()` (`src/authkit-callback-route.ts`) | `handleCallbackRoute()` (`src/server/server.ts`)  |

### 4. Provider Component (Client-Side)

Both packages provide an `AuthKitProvider` React context component:

| Feature            | Next.js                               | TanStack Start                           |
| ------------------ | ------------------------------------- | ---------------------------------------- |
| File               | `src/components/authkit-provider.tsx` | `src/client/AuthKitProvider.tsx`         |
| State management   | React context + state                 | React context + state                    |
| Session monitoring | Visibility change handler             | Visibility change handler                |
| Initial auth       | Server-side via RSC                   | `initialAuth` prop from loader           |
| Navigation         | Next.js router                        | `@tanstack/react-router` `useNavigate()` |

### 5. Client Hooks

| Hook         | Next.js                     | TanStack Start                                      |
| ------------ | --------------------------- | --------------------------------------------------- |
| Auth state   | `useAuth()` (from provider) | `useAuth()` (`src/client/AuthKitProvider.tsx`)      |
| Access token | `useAccessToken()`          | `useAccessToken()` (`src/client/useAccessToken.ts`) |
| Token claims | `useTokenClaims()`          | `useTokenClaims()` (`src/client/useTokenClaims.ts`) |

## Shared vs Framework-Specific

### Shared (via authkit-session or duplicated)

- Session interface: `{ accessToken, refreshToken, user, impersonator? }`
- Auth result discriminated union: `{ user: User, ... } | { user: null }`
- Token claims shape: `{ sid, org_id?, role?, permissions?, entitlements?, feature_flags? }`
- Cookie config: httpOnly, sameSite, secure, path, maxAge
- OAuth callback flow: code exchange --> encrypt session --> save cookie --> redirect

### Framework-Specific (must be implemented per framework)

- **Middleware hook-in**: How the framework intercepts requests
- **Cookie access**: Framework-specific request/response APIs
- **Navigation**: Framework router for redirects
- **SSR integration**: How auth state passes from server to client
- **Header propagation**: Framework-specific header handling

## Required Exports

A complete AuthKit framework package should export:

```
// Server
authkitMiddleware()      -- middleware factory
withAuth() / getAuth()   -- session validation
getSignInUrl()           -- authorization URL
getSignUpUrl()           -- sign-up URL
signOut()                -- session termination
handleAuth()             -- OAuth callback handler

// Client
AuthKitProvider          -- React context provider
useAuth()                -- auth state hook

// Types
Session, UserInfo, NoUserInfo, AuthkitMiddlewareOptions
```

## Building a New Framework Integration

1. **Create storage adapter** extending `CookieSessionStorage` from `authkit-session`
2. **Create auth service** via `createAuthService({ sessionStorageFactory })` from `authkit-session`
3. **Wrap in middleware** using the framework's middleware system
4. **Export server helpers** that delegate to `AuthService` methods
5. **Build provider** with React context, visibility-change session monitoring
6. **Build hooks** for client-side auth state access
7. **Add callback route handler** using `AuthService.handleCallback()`

Use `../authkit-tanstack-start/` as the template -- it fully consumes `authkit-session`.
