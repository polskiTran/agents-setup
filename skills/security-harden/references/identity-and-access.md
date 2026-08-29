# Identity and Access

## Authorization

- Enforce authorization at every server-side entry point, including alternate methods, background jobs, bulk APIs, GraphQL resolvers, WebSockets, exports, and administrative tools.
- Check the requested action against the specific object, field, tenant, and current state. A role check alone does not prevent object-level or cross-tenant access.
- Centralize policy decisions where practical, default-deny, and keep enforcement near the protected operation. Deny when policy context is missing or evaluation fails.
- Derive tenant and owner scope from trusted identity context, not from an unverified request parameter.
- Prevent mass assignment by defining writable fields per operation and role. Filter output fields as deliberately as input fields.
- Reauthorize long-running and asynchronous work when queued permissions may become stale, or capture a narrowly scoped immutable authorization decision.
- Test horizontal, vertical, tenant, object, field, state-transition, and alternate-route boundaries.

## Authentication and recovery

- Prefer a maintained identity provider or framework over custom authentication.
- Support phishing-resistant authentication such as passkeys/WebAuthn where the risk and product permit it. Require MFA for privileged and high-impact actions.
- Make enrollment, factor replacement, recovery, email change, and account linking at least as strong as normal authentication. Notify users of security-sensitive changes.
- Avoid account enumeration by keeping externally visible behavior reasonably consistent while preserving actionable internal logs.
- Throttle authentication by account and network signals. Use progressive delay, risk checks, and temporary controls rather than an easily abused permanent lockout.
- Reauthenticate for sensitive actions and after elevated risk. Do not rely only on an old session's existence.

## Password storage

- Prefer Argon2id. Take the current minimum parameters from `references/standards-and-sources.md` — the single source for dated numeric baselines in this skill — then benchmark and increase cost within the service's latency and capacity budget.
- If Argon2id is unavailable, use scrypt with current reviewed parameters. Treat bcrypt as a legacy fallback at the work factor recorded in `standards-and-sources.md`, and handle its 72-byte input limit explicitly without silent truncation.
- For FIPS-constrained password storage, use the current approved PBKDF2-HMAC configuration; verify the current iteration baseline before introducing an exact value.
- Use library-managed unique salts. Store an optional pepper separately in a secret manager and plan its rotation consequences.
- Upgrade outdated password hashes after successful authentication. Never use fast general-purpose hashes for password storage.

## Sessions and cookies

- Prefer opaque, server-managed browser sessions when distributed stateless tokens are not required.
- Generate high-entropy session identifiers with a cryptographic random generator. Regenerate identifiers after authentication, privilege elevation, and other trust changes.
- Use cookies with `Secure`, `HttpOnly`, a narrowly chosen `Path` and host scope, and `SameSite=Lax` or `SameSite=Strict` according to the navigation and SSO design. Prefer the `__Host-` prefix when its constraints fit.
- Enforce idle and overall expiration server-side. Select limits from risk, assurance level, device management, environment, and user workflow rather than applying a universal 8-hour/30-minute rule.
- Invalidate server state on logout and revocation. Cookie deletion alone is insufficient.
- Protect cookie-authenticated state changes against CSRF. Rotate session secrets after privilege changes and consider revoking other sessions after credential recovery.

## JWT and bearer tokens

- Use JWT only when its distributed claims or verification properties are needed. An opaque reference token is often simpler to revoke and constrain.
- Configure an explicit algorithm allowlist in the verifier. Never choose validation behavior from the token's `alg` header, and never accept `none`.
- Define the token profile's required claims, normally including issuer, audience, subject, expiry, not-before or issued-at constraints, token type, and application-specific authorization claims. Validate every required claim, apply only small explicit clock skew, and reject missing or malformed values.
- Bind trusted keys to the expected issuer and algorithm. Treat `kid` as untrusted lookup input. Do not follow token-provided `jku` or `x5u` URLs unless they match a fixed trusted configuration and SSRF controls.
- Use mutually exclusive validation rules and explicit token types when one issuer creates several JWT kinds. Do not accept an ID token where an access token is required.
- Keep bearer tokens out of URLs, logs, analytics, error messages, and client-readable persistent storage. Minimize claims and avoid sensitive personal data.
- Keep access-token lifetimes short enough for the threat model. Implement revocation or introspection where immediate invalidation matters.
- Rotate refresh tokens atomically. On confirmed reuse, revoke the token family while accounting for legitimate concurrency and retry behavior. Bind refresh tokens to client/session context where supported.

## OAuth and OpenID Connect

- Use maintained protocol libraries and discovery metadata from a configured trusted issuer.
- Use Authorization Code with PKCE for public clients. Do not use the implicit grant or resource-owner password grant for new systems.
- Validate exact redirect URIs, issuer, state, nonce where applicable, audience, authorization response mix-up protections, and token type.
- Request the minimum scopes and audience. Do not treat an access token as proof that a user is currently present.
- Design logout, local session termination, upstream identity-provider sessions, consent, and token revocation as separate lifecycle concerns.

## Useful primary guidance

- IETF JWT Best Current Practices, RFC 8725: https://www.rfc-editor.org/rfc/rfc8725.html
- NIST SP 800-63B: https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP OAuth 2.0 Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html
