---
id: provider-neutral-sandbox-runtime
authority: canonical
status: canonical
title: Provider-neutral Sandbox Runtime
genre: adr
last_verified: 2026-09-02
---

# 0001: Provider-neutral Sandbox Runtime

- Status: accepted for `0.1.0-dev`
- Date: 2026-09-01

## Context

Agent applications need isolated execution environments, while available runtimes expose different
lifecycle, readiness, execution, persistence, and networking APIs. Binding applications directly to
one provider makes capability changes and migration expensive.

## Decision

Define a small portable core with:

- logical identity plus generation fencing;
- explicit lifecycle and readiness;
- capability negotiation;
- provider SPI and namespaced extensions;
- a reference runtime and reusable conformance checks.

The core will not standardize provider implementation details or claim equivalent security.

## Consequences

- Applications can depend on portable lifecycle semantics.
- Providers can expose additional behavior without expanding the core.
- Unsupported capabilities fail before allocation.
- Conformance becomes part of compatibility claims.
- Provider adapters and production control planes remain responsible for durable scheduling,
  security, networking, and operations.
