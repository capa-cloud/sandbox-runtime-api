---
id: quickstart
authority: reference
status: active
title: Local quickstart
genre: how-to
last_verified: 2026-10-09
---

# Local Quickstart

> The Local Provider runs ordinary host processes. It is for development and contract testing only;
> it does not isolate untrusted code.

## Install and verify

This section builds from a Git checkout. For an independently installable prebuilt archive, see
[Release delivery](delivery.md).

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
Requests must use a loopback authority with the listening port. Browser metadata must identify the
same origin; JSON body endpoints reject simple form/text media types. These checks do not authenticate
local processes or make the Local Provider safe for untrusted code.

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
