# Security Audit Notes

Date: 2026-05-16

Scope: `api-server` public HTTP/WebSocket API, auth, push notification paths, dependency tree, and build/test verification.

## Hardening Applied

- Upgraded the production JWT stack to remove critical `fast-jwt` advisories.
- Removed the unused `@railway/cli` dev dependency and upgraded build/test tooling to current non-vulnerable ranges.
- Updated transitive `fast-uri` and `fast-xml-builder` resolutions to remove high-severity advisories.
- Added an explicit request body limit.
- Normalized CORS origins and reject `*` in production while credentials are enabled.
- Added `X-Content-Type-Options`, `Referrer-Policy`, and `X-Frame-Options` headers.
- Added optional bearer-token protection for `/metrics` via `METRICS_TOKEN`.
- Added WebSocket max payload protection plus schema validation for client subscription messages and filters.
- Escaped market search before building a Mongo regex.
- Added bounds to query/body inputs that were previously unbounded strings, cursors, arrays, or numbers.
- Redacted FCM tokens in logs and stopped logging raw Redis message payloads on parse failures.

## Residual Notes

- `npm audit` still reports low-severity findings in Firebase Admin optional Firestore/Storage dependencies. This service uses Firebase Messaging only. Firebase Admin `13.10.0` is current; npm's suggested "fix" is a downgrade to `10.3.0`, which is not appropriate.
- Do not set repo-wide `omit=optional`; esbuild/Vitest/Rolldown use optional native packages and builds/tests fail without them.
- Recommended Railway env hygiene: keep `CORS_ORIGINS` explicit, set `JWT_SECRET` to a long random value, set `METRICS_TOKEN` if `/metrics` is reachable outside trusted infrastructure, and keep Mongo/Redis private.

## Verification

- `npm test`
- `npm run build`
- `npm audit --json` (only low-severity Firebase optional dependency findings remain)
