---
id: docs-index
authority: canonical
status: canonical
title: Sandbox Runtime API documentation index
genre: spec
last_verified: 2026-10-14
---

# Documentation Index

## Active context

The `v0.1.2` delivery implements the `0.1` contract. It owns portable lifecycle, capability negotiation,
command and file operations, event replay, the TypeScript SDK, the loopback-only reference server,
the unsafe Local Provider, and provider conformance.

The [v0.1.2 changelog](CHANGELOG.md) records Provider data-minimization fixes. Older release archives
do not contain these fixes; use the current [release guide](docs/delivery.md).

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
- [Release archive and acceptance map](docs/delivery.md)
- [Clean-room policy](docs/clean-room-policy.md)
- [Public safety and commit identity](docs/public-safety.md)
- [Visual source and validation register](docs/visuals/README.md)

## Process and release evidence

- [v0.1 completion summary](docs/00-v0.1-summary.md)
- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md)
