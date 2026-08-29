# Standards and Sources

Baseline reviewed: 2026-08-08.

This file is the single source of truth for dated numeric baselines in this skill (work factors, parameter minimums, iteration counts). Other reference files intentionally do not restate these numbers — read the current values here, and when updating them, update only this file and refresh the baseline date above.

Security standards, algorithms, library behavior, product defaults, regulations, and recommended work factors change. Before presenting an exact value as current, verify it against the authoritative source when internet access is permitted. State the source date or version in formal reports.

## Choose the right framework

- Use OWASP ASVS 5.0.0 as the primary source of testable web-application security requirements: https://owasp.org/www-project-application-security-verification-standard/
- Use the OWASP Top 10 for awareness and executive risk communication, not as proof of review completeness: https://owasp.org/Top10/2025/
- Use CWE to name weakness classes and connect findings to engineering guidance: https://cwe.mitre.org/
- Use protocol specifications and best-current-practice RFCs for JWT, OAuth, TLS, HTTP, and related protocols rather than blog summaries.
- Use NIST SP 800-63-4 for risk-based digital identity guidance when applicable: https://pages.nist.gov/800-63-4/
- Use ecosystem and framework documentation for exact secure APIs and version-specific behavior.
- For design-level review, threat modeling, and insecure-design findings, use the OWASP Threat Modeling Cheat Sheet (https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html) and the OWASP Secure Product Design Cheat Sheet (https://cheatsheetseries.owasp.org/cheatsheets/Secure_Product_Design_Cheat_Sheet.html). Ground design findings in a stated attacker capability and trust boundary, not in style preference.

Do not claim legal, regulatory, PCI DSS, HIPAA, SOC 2, ISO 27001, FedRAMP, or other compliance from a code review. Map only to a named version, scope, evidence set, and control ownership supplied or agreed by the user.

## OWASP Top 10:2025

Use the official 2025 categories exactly:

1. A01 Broken Access Control
2. A02 Security Misconfiguration
3. A03 Software Supply Chain Failures
4. A04 Cryptographic Failures
5. A05 Injection
6. A06 Insecure Design
7. A07 Authentication Failures
8. A08 Software or Data Integrity Failures
9. A09 Security Logging and Alerting Failures
10. A10 Mishandling of Exceptional Conditions

SSRF is incorporated into A01 in the 2025 taxonomy; it is not A10.

## Current baseline notes

Verify these before copying them into long-lived policy:

- OWASP password storage currently recommends Argon2id with at least 19 MiB memory, 2 iterations, and parallelism 1. It treats bcrypt as a legacy fallback with work factor at least 10 and a 72-byte input limit: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- IETF JWT BCP requires callers to restrict acceptable algorithms and provides issuer, audience, key, type, and indirect-attack guidance: https://www.rfc-editor.org/rfc/rfc8725.html
- NIST session limits depend on authentication assurance level and operational context; do not impose one universal idle or overall timeout: https://pages.nist.gov/800-63-4/sp800-63b/session/
- OWASP recommends authenticated encryption and describes AES keys of at least 128 bits, ideally 256, while the correct choice remains threat-, platform-, and compliance-dependent: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- Header policy is response- and application-specific. CSP can be meaningless for non-rendered API responses, and HSTS can cause outages when deployed without complete HTTPS readiness: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html

## Evidence rules

- Cite the exact requirement identifier and version when mapping to ASVS or another standard.
- Distinguish mandatory specification language from guidance, defaults, and local policy.
- Prefer primary sources. When sources disagree, explain applicability instead of silently selecting the strictest number.
- Record whether a result was code-confirmed, configuration-confirmed, deployment-confirmed, dynamically verified, or inferred.
- Do not elevate a version string, banner, scanner alert, or dependency advisory into a vulnerability without confirming applicability.
