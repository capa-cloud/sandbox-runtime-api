---
id: roadmap
authority: process
status: active
title: Public roadmap
genre: draft
last_verified: 2026-09-02
---

# Roadmap

## Completed in v0.1

- portable lifecycle and generation fencing;
- capability negotiation;
- command and file operations;
- append-only event replay and SSE;
- TypeScript SDK and loopback reference server;
- unsafe Local Provider and Mock Provider;
- provider conformance;
- clean-room, public-content, documentation, security, and CI gates.

## Candidate follow-ups

- package publication after API review;
- durable event and resource repository SPI;
- explicit TTL and idle-expiration policy;
- PTY and port-forwarding extensions;
- snapshot and volume extension contracts;
- public Kubernetes Agent Sandbox adapter;
- public OCI container adapter;
- additional client SDKs.

No provider enters the portable core solely because one deployment needs it. Cloud adapters require a
separate public-source RFC, capability mapping, security boundary, and conformance evidence.
