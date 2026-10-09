---
id: release-delivery
authority: reference
status: active
title: Release delivery and acceptance
genre: primer
last_verified: 2026-10-09
---

# Release Delivery and Acceptance

## Scope

Version `0.1.1` delivers the public `0.1` contract, TypeScript SDK, reference runtime/server/CLI,
Mock and unsafe Local Providers, conformance runner, documentation, diagrams, and a prebuilt archive.
This is development infrastructure, not a hosted or production-isolated sandbox service.

The [roadmap](../ROADMAP.md) distinguishes completed work from candidate extensions. A real cloud,
container, or Kubernetes Provider requires a separate public-source RFC, capability map, isolation
boundary, and opt-in integration evidence. Those candidates are not unfinished parts of this release.

## Install a release archive

Download `sandbox-runtime-api-0.1.1.tgz` and `SHA256SUMS.txt` from the
[v0.1.1 GitHub release](https://github.com/capa-cloud/sandbox-runtime-api/releases/tag/v0.1.1).
Verify the archive before installing:

```bash
shasum -a 256 -c SHA256SUMS.txt
npm install --ignore-scripts ./sandbox-runtime-api-0.1.1.tgz
npx sandbox-runtime serve --host 127.0.0.1 --port 4311
```

Node.js 22 or later runs the package; source development uses Node.js 22.12+ (22.x) or 24.x and
pnpm 10. The package has no production dependencies. `private: true` intentionally prevents accidental
npm registry publication; it does not prevent local installation of the archive.

The CLI uses the **unsafe Local Provider**. Only run trusted, synthetic development commands, never
untrusted or AI-generated code. Ctrl-C cleans active resource directories. User-supplied `--root`
directories are retained; only this Provider's resource directories are removed.

For embedding without host execution, start with the packaged
[Mock example](../examples/embedded-runtime.mts). For HTTP operations, use the
[API/SDK guide](api-and-sdk.md) and [quickstart](quickstart.md).

## Requirement-to-evidence map

| Requirement | Verifier | What it establishes |
| --- | --- | --- |
| Contract/version alignment | spec tests, `pnpm docs:check` | HTTP routes, vocabulary, errors, OpenAPI and Provider versions |
| Lifecycle/capabilities | runtime tests | preflight, idempotency, concurrency, reconciliation, pause/resume, termination/recreation |
| Generation fencing | runtime and HTTP/SDK tests | reject stale-generation mutations and file reads; resource discovery remains available |
| Commands/files | Local and local-boundary tests | argv, limits, cancellation, regular-file boundaries, traversal and cleanup |
| SDK/HTTP/SSE | HTTP/SDK tests | mapping, error normalization, replay, stream closure and disconnect cancellation |
| Browser boundary | server-security tests | authority/origin rejection, JSON types, exact routing, no mutation on denied requests |
| Provider compatibility | conformance/deadline tests | manifest/method alignment, bounded calls, ambiguous failure cleanup and result validation |
| Independent consumer | `pnpm pack:check` | tarball links/assets; clean install; compiled example/types; real CLI and SDK scenarios |
| Public safety | `pnpm sanitize`, scanner tests and semantic review | credentials/history, machine paths and media metadata; scanner output does not print matched values |
| Supply chain/CI | full dependency audit, Node.js 22/24 CI | frozen lockfile and complete verification on both development lines |

`pnpm check` is the full local gate; CI additionally runs `pnpm sanitize` and a production dependency
audit. Exact commit, CI runs, scan triage, artifact checksums, and publication read-back belong in
release notes and merged PR evidence. Counts in the [original v0.1 summary](00-v0.1-summary.md) remain
dated evidence, not current health assertions.

## Security and provenance

Review covers HTTP inputs, lifecycle fencing, command/process cleanup, filesystem operations,
distributed package contents, and publication safety. Fixtures use task-owned temporary directories.
Default tests need no cloud credentials, real accounts, production responses, private repositories,
or customer data.

HTTP request defenses do not authenticate a local process. Commands retain host-user permissions.
POSIX process-group cancellation covers ordinary descendants, not adversarial children that detach
into another session. Windows does not provide the same POSIX semantics; Unix FIFO/descendant
regressions are not asserted there. CI verifies Linux; local validation also verifies macOS.

Passing these gates is not isolation, production availability, penetration-testing, or compliance
certification. See [Security policy](../SECURITY.md), [Local Provider](providers/local.md), and
[provenance](../ORIGIN_AND_PROVENANCE.md) before extending the project.

## Maintenance and next development

Start at [DOCS-INDEX](../DOCS-INDEX.md). Canonical `spec/` sources own the contract; implementation and
fresh tests own behavior; dated summaries and releases own historical evidence. Begin an approved
follow-up from a clean branch in the owning public repository. A candidate item, branch, or empty
directory alone does not establish an active phase.

Coordinate Vitest/coverage upgrades, rerun all gates after substantive changes, and preserve existing
release tags. Do not lower capability or security assertions just to make tests pass.
