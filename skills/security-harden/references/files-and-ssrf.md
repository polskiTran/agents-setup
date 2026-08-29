# Files, Parsers, Webhooks, and SSRF

## Uploads and downloads

Design the upload pipeline from the business-required file types and how the application will parse, transform, store, and serve them.

- Authenticate and authorize uploads, downloads, replacements, and deletions independently.
- Enforce body-size limits before fully buffering the request. Also limit file count, dimensions, page count, archive entries, expanded bytes, compression ratio, parser time, memory, and storage quotas.
- Decode and normalize filenames before checking them. Allow only business-required extensions. Do not trust the client `Content-Type` header.
- Check expected signatures or magic bytes, but never treat them as proof of safety; polyglots and malformed files can pass superficial checks.
- Parse with maintained libraries using safe settings, timeouts, and resource limits. Isolate high-risk parsers. Re-encode images or use content disarm and reconstruction for supported document types when justified.
- Use malware scanning where risk warrants it, but do not make antivirus the only control.
- Generate an unguessable server-side storage identifier and keep the original display name as separately encoded metadata only when needed.
- Store outside the webroot or on a dedicated storage service. Prefer a separate download origin without ambient application cookies for active or user-controlled content.
- Serve through an authorization-aware handler with an explicit safe `Content-Type`, `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` when inline rendering is unnecessary.
- Protect upload endpoints against CSRF when they use ambient credentials. Quarantine until required checks complete, and define cleanup for abandoned or rejected objects.

Treat SVG, HTML, XML, PDF, office documents, media codecs, and archives as active or parser-sensitive formats. Decide whether to reject, sanitize, transform, isolate, or force-download each type.

## Server-side request forgery

Prefer accepting an application identifier that maps to a fixed server-side destination instead of accepting a URL.

When a variable destination is unavoidable:

- Allow only required schemes, usually `https`. Reject userinfo, fragments when irrelevant, ambiguous hosts, unsupported ports, and malformed encodings.
- Parse once with a maintained URL parser and make security decisions on normalized components. Avoid regex-only URL validation.
- Prefer an exact destination allowlist. If a deny policy is unavoidable, validate every resolved IPv4 and IPv6 address against loopback, private, link-local, multicast, unspecified, reserved, and environment-specific network ranges.
- Explicitly block cloud metadata and orchestration control-plane destinations. Do not rely on a short list such as only `169.254.169.254`, `10.0.0.0/8`, or IPv4 ranges.
- Resolve through trusted DNS, validate every answer, and connect to a validated address while preserving correct TLS hostname verification. Account for DNS rebinding and resolution changes.
- Disable redirects or reapply the full scheme, host, port, DNS, and IP policy to every hop.
- Do not forward user cookies, authorization headers, internal client certificates, or arbitrary request headers. Use narrowly scoped destination-specific credentials only after destination validation.
- Apply connect, TLS, read, total-time, redirect, response-size, decompression, and concurrency limits.
- Enforce egress network policy or an outbound proxy so application validation is not the only boundary. Log policy decisions without leaking credentials or sensitive response content.

Review all outbound-capable features: URL previews, importers, image fetchers, PDF renderers, webhooks, SSO metadata, package resolvers, XML entities, redirects followed by backend clients, and token-provided key URLs.

## Webhooks

- Verify signatures over the exact raw request bytes before parsing or transforming the body.
- Bind the signature to the expected sender, algorithm, and secret or key. Use constant-time comparison where the library does not handle it.
- Validate a timestamp or nonce and maintain replay protection for the accepted window. Make event processing idempotent.
- Rotate webhook secrets with an explicit overlap plan. Do not accept unsigned fallback deliveries silently.
- Authorize the event's referenced resource and tenant; a valid sender signature does not automatically authorize every requested state change.

## Useful primary guidance

- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Unvalidated Redirects and Forwards Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
