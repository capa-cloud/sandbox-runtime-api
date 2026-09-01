# Sandbox Runtime API

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
</p>

Sandbox Runtime API is an independently designed, provider-neutral contract for creating,
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
  Local              Docker   Kubernetes / Cloud
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

## Current Status

Version `0.1.0-dev` is a clean-room, pre-release development baseline. It currently contains:

- a transport-neutral TypeScript protocol model;
- capability preflight;
- generation-fenced mutation semantics;
- an in-memory runtime;
- a mock provider;
- a provider conformance runner;
- public-source provenance and clean-room contribution rules.

The protocol is expected to change before `1.0.0`.

## Quick Start

Requirements: Node.js 22 or later and pnpm 10.

```bash
pnpm install
pnpm check
```

## Repository Map

| Path | Purpose |
| --- | --- |
| `src/protocol.ts` | Portable states, resources, capabilities, and errors |
| `src/provider.ts` | Provider SPI |
| `src/runtime.ts` | In-memory reference runtime |
| `src/providers/mock.ts` | Deterministic development provider |
| `src/conformance.ts` | Reusable provider checks |
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
