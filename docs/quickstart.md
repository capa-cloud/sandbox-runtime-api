---
id: quickstart
authority: reference
status: active
title: Local quickstart
genre: how-to
last_verified: 2026-09-02
---

# Local Quickstart

> The Local Provider runs ordinary host processes. It is for development and contract testing only;
> it does not isolate untrusted code.

## Install and verify

```bash
pnpm install
pnpm check
pnpm build
```

## Start the reference server

```bash
node dist/cli.js serve --host 127.0.0.1 --port 4311
```

The server prints its base URL and binds to loopback by default. It has no authentication and refuses
a non-loopback address unless the embedding application explicitly enables the unsafe override.

## Create and use a sandbox

```bash
curl -s -X POST http://127.0.0.1:4311/v1/sandboxes \
  -H 'content-type: application/json' \
  -d '{"clientRequestId":"quickstart","requiredCapabilities":["commandExecution","fileAccess"]}'
```

Use the returned `id` for execution:

```bash
curl -s -X POST http://127.0.0.1:4311/v1/sandboxes/<id>/commands \
  -H 'content-type: application/json' \
  -d '{"expectedGeneration":1,"argv":["printf","hello"]}'
```

Use the returned `generation` when terminating:

```bash
curl -s -X POST http://127.0.0.1:4311/v1/sandboxes/<id>/actions/terminate \
  -H 'content-type: application/json' \
  -d '{"expectedGeneration":1}'
```

See [API and SDK guide](api-and-sdk.md) for the complete MVP surface.
