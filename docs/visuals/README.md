---
id: visual-source-register
authority: reference
status: active
title: Visual source and validation register
genre: reference
last_verified: 2026-09-03
---

# Visual Source and Validation Register

Images explain the public contract but do not replace the normative text, TypeScript types, or
OpenAPI document. All visuals use only concepts already present in this repository.

## Generation receipt

- producer: AnyCap CLI `0.6.1` with `gpt-image-2`;
- generated: 2026-09-03;
- assurance: T1 validated explanation;
- visible language: Simplified Chinese;
- style: flat white technical canvas, neutral gray, restrained blue, no logos or gradients;
- retained metadata: model and fact graph only; account metadata and request identifiers are omitted.

## Runtime overview

- viewer question: How do clients reach different Provider implementations through one portable API?
- takeaway: SDK, HTTP/SSE, and CLI converge on the portable runtime and cross one Provider SPI.
- nodes: application or Agent Harness; combined SDK/HTTP/SSE/CLI access layer; Sandbox Runtime API;
  lifecycle, command, file, and event operations; Provider SPI; Mock Provider; Local Provider; future
  Provider.
- edges: application to the access layer; access layer to the runtime; runtime to the Provider SPI;
  SPI to peer Provider implementations.
- boundaries: portable core; Provider implementations.
- forbidden: cloud logos, private deployment topology, direct client-to-Provider calls, or presenting
  a future Provider as shipped in v0.1.
- asset: [`runtime-overview.png`](../assets/runtime-overview.png).

## Capability preflight

- viewer question: Why must capability negotiation happen before allocation?
- takeaway: client requirements and the Provider manifest meet at preflight; unsupported requests
  fail before allocation.
- nodes: client requirements; `requiredCapabilities`; runtime preflight; `Provider Manifest`;
  supported branch; allocation; unsupported branch; `unsupported_capability`; pre-allocation failure.
- edges: requirements and manifest to preflight; supported branch to allocation; unsupported branch
  to error and pre-allocation failure.
- forbidden: implying that a capability certifies security, health, SLO, or cross-Provider parity.
- asset: [`capability-preflight.png`](../assets/capability-preflight.png).

## Provider conformance

- viewer question: What evidence supports a Provider capability claim?
- takeaway: conformance checks manifest, bounded readiness, declared behaviors, cleanup, and complete
  result shapes. The adjacent text owns the unique synthetic-resource requirement.
- nodes: Provider adapter; `describe`; `provision`; observe until `ready`; command probe; file
  round-trip; complete-shape validation; bounded timeout; `terminate`; pass or fail.
- edges: setup flows through describe, provision, and readiness; command and file probes are peers;
  both join shape validation; all paths reach cleanup before the result.
- forbidden: serializing the command and file probes, claiming production certification, real account
  identifiers, or a universal probe command.
- asset: [`provider-conformance.png`](../assets/provider-conformance.png).

## Exact deterministic visuals

- [`lifecycle-state-machine.svg`](../assets/lifecycle-state-machine.svg) is generated from the state
  transitions in [`spec/runtime-model.md`](../../spec/runtime-model.md).
- [`local-provider-boundary.svg`](../assets/local-provider-boundary.svg) is generated from the Local
  Provider behavior and security warnings in [`docs/providers/local.md`](../providers/local.md).

These two visuals are deterministic because state and security boundaries must not depend on
generative interpretation.

## Acceptance evidence

- both candidates for each AnyCap visual were inspected at original 2048×1152 resolution;
- the retained three images passed an independent AnyCap image-read audit for exact text, edges,
  boundaries, and peer relationships with zero critical mismatch;
- rejected candidates are not retained because they contained misspellings, extra text, a wrong
  boundary, or a missing cleanup step;
- generated PNG metadata was stripped before repository inclusion and scanned for request IDs,
  account metadata, local paths, credentials, and internal identifiers;
- deterministic SVGs were rendered at 1600×900 and inspected for legibility and arrow direction.

## Asset integrity

| Asset | SHA-256 |
| --- | --- |
| `capability-preflight.png` | `b81e0b5bc1f1f7384abe4b1bd269e9f33542498631700bfa4bcde003959702a5` |
| `lifecycle-state-machine.svg` | `24226bd238c76efe4b1e5b59534dff71fdf6d9d6b99b41c33235e2260c112e65` |
| `local-provider-boundary.svg` | `a43e86f0dfe61f88273e7184a866512d1bd705d483828f8101dc2412ad247aa8` |
| `provider-conformance.png` | `c0b691c8c87f5da57de2db77c9dee7fba7426846a67bb91c024067e07de47fe8` |
| `runtime-overview.png` | `e78de10f7ab408f4b9c1b3e6ed2140ad04c13703e3f7e5c20da597779feec19e` |
