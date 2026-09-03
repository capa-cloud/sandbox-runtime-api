---
id: docs-index
authority: canonical
status: canonical
title: Sandbox Runtime API documentation index
genre: spec
last_verified: 2026-09-03
---

# Documentation Index

## Active context

The `v0.1` MVP is the current public baseline. It owns portable lifecycle, capability negotiation,
command and file operations, event replay, the TypeScript SDK, the loopback-only reference server,
the unsafe Local Provider, and provider conformance.

Real cloud providers, production multi-tenancy, strong isolation, durable storage, authentication,
network policy enforcement, snapshots, PTY, and port forwarding remain outside the completed MVP.

## Canonical contract

- [Runtime model](spec/runtime-model.md)
- [Protocol](spec/protocol.md)
- [Capabilities](spec/capabilities.md)
- [OpenAPI](spec/openapi.yaml)
- [Provider-neutral decision](spec/decisions/0001-provider-neutral-sandbox-runtime.md)
- [Non-goals](NON_GOALS.md)
- [Origin and provenance](ORIGIN_AND_PROVENANCE.md)
- [Security policy](SECURITY.md)

## Reference guides

- [Quickstart](docs/quickstart.md)
- [API and SDK guide](docs/api-and-sdk.md)
- [Local Provider](docs/providers/local.md)
- [Testing and conformance](docs/testing.md)
- [Clean-room policy](docs/clean-room-policy.md)
- [Visual source and validation register](docs/visuals/README.md)

## Process and release evidence

- [v0.1 completion summary](docs/00-v0.1-summary.md)
- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md)
