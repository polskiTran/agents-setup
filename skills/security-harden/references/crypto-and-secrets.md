# Cryptography and Secrets

## Decide what needs protection

- Start with the threat model and data lifecycle. Minimize collection and retention before adding encryption.
- Identify whether protection is needed at rest, in transit, in use, against operators, against storage theft, or against application compromise. Encryption at one layer does not solve every threat.
- Use established protocols and maintained platform or library APIs. Never design a new cryptographic primitive or protocol.

## Encryption and integrity

- Prefer a current authenticated-encryption construction supported safely by the platform, such as AES-GCM with a 128- or 256-bit key or ChaCha20-Poly1305.
- Guarantee nonce uniqueness for each key. A random 96-bit GCM nonce can be appropriate at bounded volume, but collision probability becomes operationally relevant at scale. Prefer library-managed nonces or a design with a provable uniqueness strategy.
- Authenticate version, tenant, record identity, and other security-relevant unencrypted context as associated data when appropriate.
- Separate keys by purpose and environment. Do not reuse one key across encryption, signing, token, tenant, or protocol contexts.
- Version ciphertext and key references so rotation and algorithm migration are possible. Define failure behavior for missing keys, corrupted ciphertext, and partial rotations.
- Do not use ECB. Do not use unauthenticated CBC or CTR without a correctly composed encrypt-then-MAC design from a reviewed library.

## Password-derived keys and hashes

- Distinguish password verification from deriving encryption keys. Use a password-hashing or KDF API intended for the exact purpose.
- Prefer memory-hard Argon2id or scrypt with unique salts and parameters selected by current guidance and measured resource budgets.
- Use PBKDF2 when required by a validated platform or compliance regime, with the currently approved hash and work factor.
- Do not list bcrypt as a generic encryption-key derivation method. Its input and output semantics are intended for password hashing.

## Randomness

- Use cryptographic randomness: `secrets` in Python, `crypto.randomBytes` or Web Crypto in JavaScript, `crypto/rand` in Go, and `OsRng` or `getrandom`-backed APIs in Rust.
- Avoid `Math.random`, language PRNGs intended for simulation, timestamps, UUID variants without sufficient randomness, and homegrown mixing.
- Generate enough entropy for the use case and encode without truncating it accidentally.

## Key and secret lifecycle

- Prefer workload identity and short-lived dynamically issued credentials over long-lived static secrets.
- Keep production secrets in a secret manager or protected platform facility. Environment variables can be acceptable for local development and some runtimes, but evaluate process inspection, crash dumps, child-process inheritance, and platform exposure.
- Apply least privilege and separate credentials by service, environment, tenant boundary where required, and operational role.
- Never place secrets in source, client bundles, images, test fixtures, command lines, URLs, logs, telemetry, or exception messages.
- Scan current content and relevant history when exposure is suspected. Treat a committed secret as compromised and rotate or revoke it; deletion from the latest revision is insufficient.
- Automate issuance, distribution, rotation, revocation, and audit. Choose lifetimes from risk and system capability rather than universal 90-day or 180-day schedules. Rotate immediately on suspected compromise or authorization change.
- Protect backups, replicas, caches, and derived credentials. Define recovery and emergency revocation procedures.

## TLS and service identity

- Prefer TLS 1.3. Support TLS 1.2 only where compatibility requires it and restrict it to current AEAD suites. Disable older protocols and obsolete ciphers.
- Verify hostname, chain, validity, and intended trust anchors. Do not disable certificate verification to solve development problems.
- Use mTLS or signed workload identity where both peers require strong service authentication, while planning certificate issuance, rotation, and revocation.
- Keep private keys non-exportable when platform support and risk justify it. Restrict key-use permissions, not only key-read permissions.

## Useful primary guidance

- OWASP Cryptographic Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP Key Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html
- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- OWASP TLS Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
