---
id: protocol
authority: canonical
status: canonical
title: Portable protocol semantics
genre: spec
last_verified: 2026-09-02
---

# Portable Protocol Semantics

## Transport

The normative HTTP projection uses JSON under `/v1`. Errors use:

```json
{
  "error": {
    "code": "generation_conflict",
    "message": "expected generation 1, observed 2"
  }
}
```

The stable machine field is `error.code`. Human-readable messages may improve without a protocol
version change.

## Lifecycle

Create is idempotent by `clientRequestId`. Concurrent identical requests converge to one logical
resource; the same key with different intent returns `idempotency_conflict`.
An idempotency key is scoped to the generation it created. Replaying an older generation's key after
recreation returns `idempotency_conflict` instead of returning a resource with a different spec.

State-changing and destructive calls carry `expectedGeneration`. A stale generation returns
`generation_conflict`. A terminated logical resource may be recreated with a new request ID and
generation `n + 1`.

Command execution and every file operation also carry `expectedGeneration`. This prevents a client
holding generation `n` from reading or mutating generation `n + 1` after recreation.

Provider observations must follow the transition table in [Runtime model](runtime-model.md). An
invalid observation is a provider protocol failure, not a new portable state.

Extension keys are namespaced strings such as `example.feature`. Extension values must be JSON and do
not become portable guarantees.

## Command execution

Commands are argument vectors, never shell strings. Portable results contain:

- nullable exit code;
- UTF-8 stdout and stderr;
- timeout and truncation flags;
- an explicit cancellation flag;
- start and finish timestamps.

`timeoutSeconds` is a wall-clock bound. `maxOutputBytes` applies independently to stdout and stderr,
so the combined retained output is at most twice that value. A provider may apply a stricter
documented limit. Command execution is available only while the sandbox is `ready` and only when the
manifest declares `commandExecution`.

## Files

Portable file content uses base64. Paths are sandbox-relative. A conforming provider must prevent
lexical or symbolic-link traversal outside its declared filesystem boundary. The portable MVP
supports read, write, and one-directory listing; recursive transfer and deletion are not included.

## Events

Events are append-only within one runtime process and use monotonically increasing integer cursors.
Consumers may list events after a cursor or consume Server-Sent Events. Event replay is a transport
convenience in the reference runtime, not durable event storage. The reference runtime retains a
bounded history; a cursor older than the retained window returns `event_history_unavailable`.

Event payloads never contain command stdout/stderr or file bytes. Providers and deployments must not
place credentials or user data in extension metadata.

## Capability contract

A declared capability means that the provider implements the portable method set and should pass the
matching conformance cases. It does not certify security, availability, performance, or equivalence to
another provider.
