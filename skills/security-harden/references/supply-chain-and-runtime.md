# Supply Chain and Runtime

## Dependencies and artifacts

- Inventory direct, transitive, build, test, runtime, container, action, plugin, and infrastructure dependencies. Keep manifests and lockfiles consistent.
- Treat dependency-audit output as triage input, not a pass/fail certification. Confirm the installed version, affected feature, runtime reachability, exploit conditions, available fix, and regression risk.
- Do not automatically apply major upgrades or force audit fixes. Prefer the smallest supported update, then run compatibility and security regression tests.
- Remove unused dependencies and constrain package-manager lifecycle scripts where practical. Use trusted registries and prevent dependency-confusion through namespace and registry configuration.
- Generate and retain an SBOM for release artifacts when the product risk warrants it. Track provenance from source and build inputs to the deployed artifact.
- Verify signatures or attestations where the ecosystem supports a meaningful trust policy. A signature without a trusted identity and policy is not sufficient.
- Pin CI actions, build images, compilers, and deployment tooling to immutable reviewed versions or digests. Use controlled automation to keep them current.

## CI/CD

- Grant workflows minimum repository, cloud, package, and deployment permissions. Prefer short-lived federated credentials to static secrets.
- Do not expose privileged secrets to untrusted forks, pull requests, build scripts, or artifacts.
- Separate build, test, signing, and deployment authority. Protect release branches, environments, approvals, and artifact promotion.
- Treat repository-controlled build files as code execution. Review changes to workflows, actions, dependency sources, container bases, and publishing configuration as security-sensitive.
- Keep signing keys and production deployment authority outside ordinary developer jobs. Record who or what produced and promoted an artifact.

## Containers, infrastructure, and cloud

- Use minimal maintained base images and pin release inputs. Run as a non-root identity, drop capabilities, use read-only filesystems where compatible, and set CPU, memory, process, and storage limits.
- Do not bake secrets into layers or build arguments. Review image history and build caches when exposure is suspected.
- Apply least-privilege IAM to workloads, people, CI, and break-glass roles. Restrict both resource scope and permitted actions; review trust and assume-role policies.
- Keep databases, queues, caches, admin interfaces, metadata services, and control planes off public networks unless explicitly required.
- Encrypt transport, authenticate peers, restrict egress, and segment high-impact services. Validate object-storage public-access and cross-account policies.
- Scan infrastructure configuration, but verify provider defaults and deployed state before reporting an issue. Do not modify live infrastructure during a code-only hardening request.

## Database and data lifecycle

- Use separate least-privilege database identities per service and environment. Application identities should not own schemas or perform administrative operations.
- Protect migrations and maintenance paths separately from runtime access. Test rollback and partial-failure behavior.
- Classify sensitive data, minimize collection, define retention and deletion, and include replicas, caches, analytics, exports, logs, search indexes, and backups.
- Test backup restoration and restrict backup access. Encryption without access control, integrity, and recovery testing is incomplete.

## Exceptional conditions and availability

- Fail closed for authorization, identity, signature, policy, and integrity checks. Do not silently continue with a permissive default when a dependency or policy engine fails.
- Use transactions, idempotency keys, compensating actions, and atomic state transitions for security-sensitive workflows. Prevent replay and double-spend behavior.
- Bound retries with jittered backoff and a total deadline. Avoid retry storms and unbounded queue redelivery.
- Handle parser errors, integer bounds, nulls, duplicate fields, partial reads, timeouts, cancellation, and resource cleanup deliberately.
- Apply quotas and rate limits to authenticated as well as public expensive operations. Protect downstream services and shared tenants from noisy neighbors.
- Return generic external errors while preserving correlated internal diagnostics. Test failure paths, not only successful requests.

## Logging, alerting, and response

- Log authentication events, authorization denials, privilege and policy changes, recovery, token reuse, secret access, administrative actions, validation failures, and security-control failures when useful.
- Never log passwords, session secrets, bearer tokens, private keys, raw authorization headers, recovery codes, or unnecessarily sensitive request bodies. Redact structured fields at the logging boundary.
- Encode or structure untrusted log data to prevent log injection. Include stable event names, timestamps, correlation identifiers, actor, target, outcome, and source context.
- Protect log transport, access, integrity, retention, and time synchronization. Separate audit logs from ordinary debug logs where required.
- Connect high-signal events to owned alerts and response playbooks. Logging without actionable alerting and review provides limited detection value.

## Useful primary guidance

- OWASP Software Supply Chain Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Software_Supply_Chain_Security_Cheat_Sheet.html
- OWASP Dependency Graph and SBOM Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Dependency_Graph_SBOM_Cheat_Sheet.html
- OWASP Docker Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
