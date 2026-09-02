---
id: testing
authority: reference
status: active
title: Testing and provider conformance
genre: how-to
last_verified: 2026-09-02
---

# Testing and Provider Conformance

## Required local gates

```bash
pnpm check
pnpm build
pnpm sanitize
pnpm docs:check
pnpm test:coverage
pnpm pack:check
```

`pnpm check` runs formatting, lint, type checking, and the complete test suite. CI runs the same gates
on Node.js 22 and 24, followed by the production dependency audit.

## Test dimensions

| Dimension | Coverage |
| --- | --- |
| Unit and boundary | validation, lifecycle, errors, event cursors |
| Invariant | concurrent idempotent create and serialized termination |
| Provider contract | manifest-to-method consistency, lifecycle, command and file round-trip |
| Local integration | process execution, timeout, output bound, cleanup |
| HTTP and SDK | lifecycle, files, commands, SSE, error mapping |
| Security-negative | lexical and symbolic-link traversal, malformed input, non-loopback bind |
| Public safety | credentials, private networks, absolute paths, tracked-content scan |

## Conformance runner

`runProviderConformance(provider, options)` checks behavior declared by the Provider manifest. A
Provider that declares `commandExecution` must supply `options.commandRequest` with a safe command
known to exist in that runtime; the portable core does not assume POSIX utilities or a particular
language runtime. Each invocation uses a unique synthetic resource identity and cleans it up. A failed
check means the Provider must not claim compatibility. Passing conformance does not certify isolation,
production availability, or performance.

Provider-specific real-account tests must be opt-in, use environment-provided credentials, and stay
outside default CI.
