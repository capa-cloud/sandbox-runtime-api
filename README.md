# Sandbox Runtime API

[![CI](https://github.com/capa-cloud/sandbox-runtime-api/actions/workflows/ci.yml/badge.svg)](https://github.com/capa-cloud/sandbox-runtime-api/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
</p>

Sandbox Runtime API `v0.1` is an independently designed, provider-neutral contract for creating,
observing, controlling, and deleting isolated execution environments for AI agents and developer
tools.

The project standardizes portable lifecycle and capability semantics. It is not a hosted sandbox
platform, an agent framework, or an open-source distribution of any private system.

## Why

Agent applications need similar execution primitives but encounter provider-specific APIs for
lifecycle, readiness, command execution, files, terminals, networking, persistence, and recovery.
This project separates those concerns into:

- a versioned sandbox resource model and lifecycle;
- a provider SPI with explicit capability negotiation;
- an embeddable in-memory reference runtime;
- a deterministic mock provider;
- provider conformance checks;
- future transport mappings and client SDKs.

```text
Application or Harness Runtime
             |
     Sandbox Runtime API
             |
    +--------+---------+----------+
    |                  |          |
  Local               Mock       Future custom
 Provider            Provider      Provider
             |
        sandbox agent
```

## Relationship to Harness Runtime API

[`harness-runtime-api`](https://github.com/capa-cloud/harness-runtime-api) standardizes how an
application controls an agent harness execution. Sandbox Runtime API standardizes the isolated
compute environment in which a harness or its tools may run.

```text
Application
    -> Harness Runtime API   # conversations, executions, events, approvals
    -> Sandbox Runtime API   # environments, readiness, capabilities, recovery
    -> Provider              # local, container, Kubernetes, serverless, VM
```

Neither API requires the other. An integration may use both when it needs portable harness and
portable sandbox semantics.

## v0.1 Features

Version `0.1.0` contains:

- a normative runtime model, protocol, capability vocabulary, and OpenAPI document;
- capability preflight;
- idempotent lifecycle, reconciliation, generation fencing, and recreation;
- bounded command execution and sandbox-relative file operations;
- append-only event listing and resumable SSE projection;
- an in-memory runtime, TypeScript SDK, CLI, and loopback reference server;
- Mock and unsafe Local Providers;
- a provider conformance runner;
- public-source provenance and clean-room contribution rules.

The API remains pre-1.0 and may change incompatibly. The Local Provider is not a security sandbox and
must never execute untrusted code.

## Quick Start

Requirements: Node.js 22 or later and pnpm 10.

```bash
pnpm install
pnpm check
pnpm build
```

Continue with the [Quickstart](docs/quickstart.md) or open the
[documentation index](DOCS-INDEX.md).

## Repository Map

| Path | Purpose |
| --- | --- |
| `src/protocol.ts` | Portable states, resources, capabilities, and errors |
| `src/provider.ts` | Provider SPI |
| `src/runtime.ts` | In-memory reference runtime |
| `src/providers/local.ts` | Unsafe local-process development Provider |
| `src/providers/mock.ts` | Deterministic development provider |
| `src/conformance.ts` | Reusable provider checks |
| `src/server.ts` / `src/sdk.ts` | HTTP/SSE reference server and TypeScript client |
| `spec/` | Normative model and design decisions |
| `docs/clean-room-policy.md` | Public-source and contribution boundary |

## Clean-room Boundary

This repository is designed only from public specifications, public repositories, and general
distributed-systems principles. Contributions must not include proprietary code, private API
shapes, internal identifiers, deployment configuration, production data, or non-public test cases.

Read [Origin and provenance](ORIGIN_AND_PROVENANCE.md),
[Clean-room policy](docs/clean-room-policy.md), and [Non-goals](NON_GOALS.md) before contributing.

## License

Apache License 2.0.
