# Web and Input Security

Use these controls according to the application's actual data flows and framework.

## Validation and injection

- Validate at every trust boundary on the server. Check type, structure, length, range, encoding, and business invariants. Reject ambiguous or duplicate representations when downstream components may parse them differently.
- Use allowlists for finite business values. Do not attempt to make arbitrary input safe through a generic denylist.
- Use parameter binding for SQL, NoSQL, LDAP, and similar query values. Parameterization usually does not cover identifiers, sort directions, operators, or fragments; map those from fixed allowlists.
- Avoid shell invocation. Pass fixed executables and argument arrays without a shell. If dynamic command selection is required, map a small allowlist to fixed commands and validate each argument independently.
- Prevent template, expression-language, and code injection by keeping user input in data positions. Never construct templates, regular expressions, code, or interpreter expressions from untrusted text without a narrowly defined safe grammar.
- Configure XML parsers to disable external entities, DTDs, and unneeded network access. Use safe deserializers and explicit types; do not deserialize untrusted native objects.

Schema validation is a boundary control, not authorization or output encoding. Preserve useful client errors without exposing internal schemas or accepting partial invalid state.

## XSS and browser sinks

- Use context-specific output encoding for HTML text, attributes, URLs, JavaScript, and CSS. One encoder is not valid for every browser context.
- Prefer framework text bindings and safe DOM sinks such as `textContent`. Treat React `dangerouslySetInnerHTML`, DOM `innerHTML`, Angular trust bypasses, template escape hatches, `javascript:` URLs, and similar APIs as security-sensitive sinks.
- When rich HTML is a requirement, sanitize with a maintained allowlist sanitizer, keep it patched, and avoid mutating sanitized output with unsafe libraries afterward.
- Validate URL schemes and destinations before assigning user-controlled URLs. Encoding alone does not make an unsafe URL safe.
- Use CSP as defense in depth, not as a substitute for encoding or sanitization.

## CSRF and CORS

- Protect state-changing requests authenticated by ambient credentials, including cookies and client certificates. Use framework CSRF tokens or a well-designed signed/double-submit pattern, and validate Origin or Fetch Metadata where appropriate.
- Do not use GET for state changes. `SameSite` reduces CSRF exposure but does not replace a complete design.
- Treat CORS as a browser read-sharing policy, not authentication or authorization.
- If credentials are enabled, return one validated exact origin rather than `*`, restrict methods and headers, and emit `Vary: Origin` when the response varies by Origin.
- `Access-Control-Allow-Origin: *` can be appropriate for intentionally public, non-credentialed resources. Do not reflexively ban it.
- Parse and compare canonical origins. Do not use suffix or substring checks such as `endsWith("example.com")`.

## Paths and filesystems

Do not test path containment with a string prefix. `/srv/uploads-evil/a` starts with `/srv/uploads` as text but is outside the intended directory.

Use path-aware containment for an existing or stable filesystem:

```python
from pathlib import Path

base = Path("/srv/uploads").resolve(strict=True)
candidate = (base / user_component).resolve(strict=False)

try:
    candidate.relative_to(base)
except ValueError:
    raise ValueError("path escapes upload directory")
```

Then apply an allowlist for the business-meaningful filename or identifier. If an attacker can create or replace symlinks between validation and use, the check is subject to a time-of-check/time-of-use race. Use directory-relative APIs and platform facilities that enforce "beneath this directory" semantics, or keep the directory unmodifiable by the attacker.

Never pass user paths to shell commands. Store server-side identifiers rather than accepting absolute paths from clients.

## HTTP responses and headers

- Set the correct `Content-Type` on every response and `X-Content-Type-Options: nosniff` for browser-delivered content.
- Use `Cache-Control: no-store` for responses whose sensitive content must not be stored. Do not confuse `no-cache` with no storage.
- Build CSP for the actual frontend. Start with `Content-Security-Policy-Report-Only`, collect violations, then enforce. Prefer nonces or hashes for required inline scripts. Avoid `unsafe-eval`; avoid `unsafe-inline` where feasible.
- Apply `frame-ancestors 'none'` or a deliberate allowlist to rendered documents. `X-Frame-Options` can support older clients but is irrelevant to JSON responses and redirects.
- Enable HSTS only after verifying HTTPS on the hostname. Add `includeSubDomains` only when every subdomain supports HTTPS. Use preload only after satisfying and accepting preload-list operational requirements.
- Set `Referrer-Policy` and `Permissions-Policy` according to product behavior. Do not copy an exact policy that disables required features.
- Consider COOP, COEP, and CORP only after evaluating cross-origin integrations; these headers can break legitimate resource loading.
- Remove unnecessary technology disclosure, but do not treat header suppression as a primary security control.

## Errors, redirects, and resource limits

- Return stable client-safe errors. Keep stack traces, SQL details, internal paths, tokens, and dependency versions out of responses.
- Fail closed on authorization and validation errors. Distinguish retries from permanent failures and avoid partially committed security-sensitive operations.
- Validate redirect targets against exact permitted destinations or use local relative destinations. Do not redirect to arbitrary user-provided URLs.
- Bound request bodies, headers, parameter counts, decompressed sizes, parsing depth, query cost, response size, execution time, concurrency, and queue growth.
- Rate-limit sensitive and expensive operations using several relevant dimensions such as account, IP/network, session or API key, route, and resource. Avoid a universal threshold and avoid permanent lockouts that enable account denial of service.
- Return `429` and useful retry metadata where appropriate. Monitor limit effectiveness and false positives.

## Useful primary guidance

- OWASP Cross Site Scripting Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP SQL Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP HTTP Headers Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
