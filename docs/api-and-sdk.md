---
id: api-and-sdk
authority: reference
status: active
title: API and TypeScript SDK guide
genre: primer
last_verified: 2026-09-02
---

# API and TypeScript SDK

## HTTP resources

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Process health |
| `GET` | `/v1/runtime` | Protocol version and Provider manifest |
| `POST` | `/v1/sandboxes` | Idempotent create |
| `GET` | `/v1/sandboxes` | List resources |
| `GET` | `/v1/sandboxes/{id}` | Read one resource |
| `POST` | `/v1/sandboxes/{id}/actions/reconcile` | Refresh observed state |
| `POST` | `/v1/sandboxes/{id}/actions/{pause,resume,terminate,recreate}` | Fenced lifecycle mutation |
| `POST` | `/v1/sandboxes/{id}/commands` | Execute an argv command |
| `GET/PUT` | `/v1/sandboxes/{id}/files/content` | Read or write file bytes |
| `GET` | `/v1/sandboxes/{id}/files/entries` | List one directory |
| `GET` | `/v1/events` | Replay events after a cursor |
| `GET` | `/v1/events/stream` | SSE event stream |

The machine-readable contract is [OpenAPI](../spec/openapi.yaml).

The reference server accepts JSON request bodies up to 16 MiB by default so the Local Provider's
10 MiB raw-file limit remains reachable after base64 expansion. Embedders may lower the bound with
`maxBodyBytes` and should align it with their Provider's documented file limit.

## TypeScript client

```ts
// Inside a source checkout after `pnpm build`.
import { SandboxRuntimeClient } from '../dist/index.js'

const client = new SandboxRuntimeClient('http://127.0.0.1:4311')
const sandbox = await client.create({
  clientRequestId: crypto.randomUUID(),
  requiredCapabilities: ['commandExecution'],
})

const result = await client.execute(sandbox.id, {
  expectedGeneration: sandbox.generation,
  argv: ['printf', 'hello'],
  timeoutSeconds: 10,
})

await client.terminate(sandbox.id, sandbox.generation)
```

The npm package is intentionally not published in v0.1. Package publication remains a separately
reviewed roadmap item.

## Event replay

```ts
for await (const event of client.streamEvents({ after: 0, sandboxId: sandbox.id })) {
  console.log(event.cursor, event.type)
}
```

SSE events contain lifecycle and operation metadata only. Command output and file content remain in
their direct responses.

## Error handling

The SDK throws `RuntimeError`. Switch on `error.code`, not message text. HTTP status mapping is:

- `400`: invalid request;
- `404`: resource or route not found;
- `409`: idempotency, generation, or lifecycle conflict;
- `410`: requested event cursor is older than retained history;
- `422`: unsupported capability;
- `502`: provider contract violation;
- `503`: provider unavailable.
