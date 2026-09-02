---
id: clean-room-policy
authority: reference
status: canonical
title: Clean-room development policy
genre: how-to
last_verified: 2026-09-02
---

# Clean-room Development Policy

## Purpose

This policy keeps Sandbox Runtime API independently designed and safe for public contribution.

## Rules

1. Do not open a private repository while authoring public code, schemas, tests, or documentation.
2. Do not translate, rename, simplify, or reorganize proprietary implementation material.
3. Record public sources or independent rationale for contract changes.
4. Use synthetic identifiers and public endpoints in examples.
5. Keep provider-specific behavior behind namespaced extensions and capability declarations.
6. Treat private operational experience only as a signal that a generic problem deserves public
   research; do not reuse its implementation answer.
7. Run `pnpm sanitize` before every public push.

## Review questions

Every reviewer should be able to answer:

- Can this behavior be justified without referring to a private system?
- Is every name and field necessary for more than one provider or clearly namespaced?
- Does the test describe public contract behavior instead of mirroring a private regression?
- Are credentials, endpoints, organization names, user data, and machine paths absent?
- Does documentation distinguish portable guarantees from provider capabilities?

## Provider adapters

Provider adapters must be implemented only from public SDKs, public API documentation, and
synthetic test accounts. Real-provider tests are opt-in, use environment-provided credentials, and
must not emit account identifiers or raw responses into the repository.

## Escalation

When a contributor cannot prove public provenance, omit the material and request a legal or project
maintainer review. Do not attempt to sanitize questionable code after it has been copied.
