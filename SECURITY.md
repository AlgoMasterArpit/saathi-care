# Security policy

Saathi holds health routines for elders, so we treat every report seriously.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/AlgoMasterArpit/saathi-care/security/advisories/new) rather than a public issue. Include steps to reproduce and the impact you observed. We aim to acknowledge reports within 48 hours.

## What is in scope

- Authentication: circle codes, per-member passcodes, session tokens
- Authorisation: role permissions and the elder approval workflow
- Data exposure through `GET /api/circle` or reminder emails
- Injection through any API payload or Gemini output rendered in the UI

## Controls in place

| Area | Control |
| --- | --- |
| Passcodes | scrypt with a 16-byte random salt, constant-time verification, never returned by the API |
| Sessions | HMAC-SHA256 signed tokens, 12 h expiry, membership re-checked on every request so revocation is immediate |
| Brute force | 10 sign-in attempts per 15 minutes per IP and a single generic error for a wrong code or passcode |
| Input | Zod `.strict()` schemas on every body, 100 KB body limit (6 MB for prescription scans only) |
| Output | DOM built with `textContent` only, email HTML escaped, Gemini output schema-checked before use |
| Transport and browser | HSTS, strict CSP with no inline script or style, `frame-ancestors 'none'`, `nosniff`, Referrer-Policy, Permissions-Policy |
| Secrets | Environment variables only. `.env` and service-account files are git-ignored, and production refuses a weak `SESSION_SECRET` |
| Abuse | Rate limits on the AI and test-email endpoints. The public demo circle can never send real email |
| Runtime | Non-root container user, `npm audit` in CI |

## Out of scope

Denial of service against the free hosting tier, and social engineering of circle members.
