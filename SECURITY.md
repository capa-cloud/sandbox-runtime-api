---
id: security-policy
authority: canonical
status: canonical
title: Security policy and deployment boundary
genre: spec
last_verified: 2026-10-14
---

# Security Policy

## Supported versions

The project is pre-1.0. Security fixes are applied to the latest development release only.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when enabled. Do not open a public issue containing
exploit details, credentials, private infrastructure, prompts, or user data.

## Reference HTTP defenses

The default server requires a loopback request authority and the actual listening port. It rejects
mismatched/opaque `Origin`, cross-origin fallback `Referer`, and cross-site/same-site Fetch Metadata
when present. JSON body
endpoints require `Content-Type: application/json`. Malformed paths return portable validation errors;
extra route components do not invoke actions; responses disable MIME sniffing. These controls apply
before Provider operations, including event and resource reads.

The explicit `allowUnsafeNetwork` override permits non-loopback bind/authority names, but does not
remove origin, Fetch Metadata, JSON, or port checks. The server does not trust proxy forwarding
headers. There is no CORS allowlist or proxy-authentication feature.

SDK/CLI clients may omit browser metadata. These checks are not authentication: local processes can
still use the server. Do not expose it through a public reverse proxy. The rationale follows public
[OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
on simple content types and complete-origin comparison, plus independent authority validation for a
directly accessed development server.

## Provider error and metadata boundary

Version `0.1.2` replaces Provider exception details with fixed public messages.
Legal portable error codes remain available to callers; arbitrary Provider failure codes normalize to
`provider_unavailable`. Failure messages stored on resources are also fixed, so later list/get and
SDK calls do not reveal the original exception. Conformance reports suppress Provider exception
details while retaining runner-generated validation and deadline messages. This fix is not present
in the original `v0.1.1` archive; see the [changelog](CHANGELOG.md) for release status.

Provider endpoints must not contain URL userinfo credentials. Provider extensions, manifest fields,
endpoint paths/query parameters, command output, and file bytes are intentionally returned data, not
automatic secret-redaction surfaces. Providers must publish only approved metadata; do not put secrets
in extensions or endpoint URLs. Namespacing does not provide redaction. Diagnostics belong in a
separately authorized, redacted Provider-side channel; the reference runtime does not log raw errors.

See [public-safety guidance](docs/public-safety.md) for content and commit-identity checks.

## Deployment boundary

The reference runtime and mock provider are development implementations. They do not provide:

- tenant authentication or authorization;
- strong process, kernel, filesystem, or network isolation;
- credential storage or secret brokering;
- durable distributed scheduling;
- production rate limiting, audit retention, or disaster recovery.

A production adapter must document its trust boundary, capability limitations, credential model,
and isolation evidence. Passing portable conformance does not certify security.

The Local Provider runs processes with the current OS user's permissions. Those processes may access
the host filesystem, network, credentials, and services available to that user. Its file API path
checks do not make command execution safe for untrusted input.
