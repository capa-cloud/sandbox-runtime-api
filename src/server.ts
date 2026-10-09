import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { RuntimeError, type RuntimeErrorCode, type SandboxEvent } from './protocol.js'
import type { InMemorySandboxRuntime } from './runtime.js'
import {
  isRecord,
  parseCommandRequest,
  parseExpectedGeneration,
  parseFileWriteRequest,
  parseSandboxSpec,
} from './validation.js'

const defaultBodyLimitBytes = 16 * 1024 * 1024

const statusByCode: Readonly<Record<RuntimeErrorCode, number>> = {
  invalid_request: 400,
  unsupported_capability: 422,
  idempotency_conflict: 409,
  generation_conflict: 409,
  not_found: 404,
  invalid_state: 409,
  provider_unavailable: 503,
  provider_protocol_error: 502,
  event_history_unavailable: 410,
}

const isLoopback = (host: string): boolean =>
  host === '127.0.0.1' || host === '::1' || host === 'localhost'

const assertRequestBoundary = (request: IncomingMessage, allowUnsafeNetwork: boolean): void => {
  let authority: URL
  try {
    if (!request.headers.host) throw new Error('missing authority')
    authority = new URL(`http://${request.headers.host}`)
  } catch {
    throw new RuntimeError('invalid_request', 'request authority is invalid')
  }
  if (
    authority.username ||
    authority.password ||
    authority.pathname !== '/' ||
    authority.search ||
    authority.hash ||
    Number(authority.port || 80) !== request.socket.localPort ||
    (!allowUnsafeNetwork && !['localhost', '127.0.0.1', '[::1]'].includes(authority.hostname))
  ) {
    throw new RuntimeError('invalid_request', 'request authority is not allowed')
  }
  let origin = request.headers.origin
  if (origin === undefined && request.headers.referer !== undefined) {
    try {
      origin = new URL(request.headers.referer).origin
    } catch {
      throw new RuntimeError('invalid_request', 'request referrer is invalid')
    }
  }
  const fetchSite = request.headers['sec-fetch-site']
  if (
    (origin !== undefined && origin !== authority.origin) ||
    (fetchSite !== undefined && !['same-origin', 'none'].includes(String(fetchSite)))
  ) {
    throw new RuntimeError('invalid_request', 'cross-origin browser requests are not allowed')
  }
}

const json = (response: ServerResponse, status: number, value: unknown): void => {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

const readJson = async (request: IncomingMessage, bodyLimitBytes: number): Promise<unknown> => {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new RuntimeError('invalid_request', 'request body requires application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > bodyLimitBytes)
      throw new RuntimeError('invalid_request', 'request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RuntimeError('invalid_request', 'request body is not valid JSON')
  }
}

const eventFrame = (event: SandboxEvent): string =>
  `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

export type SandboxRuntimeServerOptions = Readonly<{
  host?: string
  port?: number
  allowUnsafeNetwork?: boolean
  maxBodyBytes?: number
}>

export type SandboxRuntimeServerHandle = Readonly<{
  baseUrl: string
  close(): Promise<void>
}>

export const startSandboxRuntimeServer = async (
  runtime: InMemorySandboxRuntime,
  options: SandboxRuntimeServerOptions = {},
): Promise<SandboxRuntimeServerHandle> => {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 4311
  const maxBodyBytes = options.maxBodyBytes ?? defaultBodyLimitBytes
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new RuntimeError('invalid_request', 'maxBodyBytes must be a positive integer')
  }
  if (!isLoopback(host) && !options.allowUnsafeNetwork) {
    throw new RuntimeError(
      'invalid_request',
      'the unauthenticated reference server may bind only to loopback',
    )
  }

  const server = createServer((request, response) => {
    response.setHeader('x-content-type-options', 'nosniff')
    void Promise.resolve()
      .then(() => {
        assertRequestBoundary(request, options.allowUnsafeNetwork ?? false)
        return handleRequest(runtime, request, response, maxBodyBytes)
      })
      .catch((error: unknown) => {
        if (response.headersSent) {
          response.end()
          return
        }
        if (error instanceof RuntimeError) {
          json(response, statusByCode[error.code], {
            error: { code: error.code, message: error.message },
          })
          return
        }
        json(response, 500, { error: { code: 'internal_error', message: 'internal server error' } })
      })
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolveListen()
    })
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()))
        server.closeAllConnections()
      }),
  }
}

const handleRequest = async (
  runtime: InMemorySandboxRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  maxBodyBytes: number,
): Promise<void> => {
  let url: URL
  let segments: string[]
  try {
    if (!request.url?.startsWith('/') || request.url.startsWith('//'))
      throw new Error('invalid target')
    url = new URL(request.url, 'http://runtime.invalid')
    segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    throw new RuntimeError('invalid_request', 'request path is invalid')
  }
  if (url.pathname.includes('//') || (url.pathname.length > 1 && url.pathname.endsWith('/'))) {
    throw new RuntimeError('not_found', 'route does not exist')
  }
  const method = request.method ?? 'GET'
  const requestIdHeader = request.headers['x-request-id']
  const abortController = new AbortController()
  response.once('close', () => {
    if (!response.writableEnded) abortController.abort()
  })
  const context = {
    requestId: typeof requestIdHeader === 'string' ? requestIdHeader : randomUUID(),
    signal: abortController.signal,
  }

  if (method === 'GET' && url.pathname === '/healthz') {
    json(response, 200, { status: 'ok' })
    return
  }
  if (method === 'GET' && url.pathname === '/v1/runtime') {
    json(response, 200, await runtime.info(context))
    return
  }
  if (method === 'GET' && url.pathname === '/v1/sandboxes') {
    json(response, 200, { sandboxes: runtime.list() })
    return
  }
  if (method === 'POST' && url.pathname === '/v1/sandboxes') {
    json(
      response,
      201,
      await runtime.create(parseSandboxSpec(await readJson(request, maxBodyBytes)), context),
    )
    return
  }
  if (method === 'GET' && url.pathname === '/v1/events') {
    const after = Number(url.searchParams.get('after') ?? '0')
    const sandboxId = url.searchParams.get('sandboxId') ?? undefined
    json(response, 200, { events: runtime.events(after, sandboxId) })
    return
  }
  if (method === 'GET' && url.pathname === '/v1/events/stream') {
    const after = Number(url.searchParams.get('after') ?? '0')
    const sandboxId = url.searchParams.get('sandboxId') ?? undefined
    const replay = runtime.events(after, sandboxId)
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    response.flushHeaders()
    for (const event of replay) response.write(eventFrame(event))
    const unsubscribe = runtime.subscribe((event) => {
      if (!sandboxId || sandboxId === event.sandboxId) response.write(eventFrame(event))
    })
    const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000)
    request.once('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      response.end()
    })
    return
  }

  if (segments[0] !== 'v1' || segments[1] !== 'sandboxes' || !segments[2]) {
    throw new RuntimeError('not_found', 'route does not exist')
  }
  const sandboxId = segments[2]
  if (segments.length === 3 && method === 'GET') {
    json(response, 200, runtime.get(sandboxId))
    return
  }
  if (segments[3] === 'actions' && segments[4] && segments.length === 5 && method === 'POST') {
    const body = await readJson(request, maxBodyBytes)
    if (segments[4] === 'reconcile') {
      json(response, 200, await runtime.reconcile(sandboxId, context))
      return
    }
    if (segments[4] === 'terminate') {
      const expectedGeneration = parseExpectedGeneration(body)
      json(response, 200, await runtime.terminate(sandboxId, expectedGeneration, context))
      return
    }
    if (segments[4] === 'pause') {
      const expectedGeneration = parseExpectedGeneration(body)
      json(response, 200, await runtime.pause(sandboxId, expectedGeneration, context))
      return
    }
    if (segments[4] === 'resume') {
      const expectedGeneration = parseExpectedGeneration(body)
      json(response, 200, await runtime.resume(sandboxId, expectedGeneration, context))
      return
    }
    if (segments[4] === 'recreate') {
      if (!isRecord(body) || body.spec === undefined) {
        throw new RuntimeError('invalid_request', 'recreate requires spec')
      }
      if (Object.keys(body).some((key) => !['expectedGeneration', 'spec'].includes(key))) {
        throw new RuntimeError('invalid_request', 'recreate contains unknown request fields')
      }
      const expectedGeneration = parseExpectedGeneration({
        expectedGeneration: body.expectedGeneration,
      })
      json(
        response,
        200,
        await runtime.recreate(sandboxId, expectedGeneration, parseSandboxSpec(body.spec), context),
      )
      return
    }
  }
  if (segments[3] === 'commands' && segments.length === 4 && method === 'POST') {
    json(
      response,
      200,
      await runtime.execute(
        sandboxId,
        parseCommandRequest(await readJson(request, maxBodyBytes)),
        context,
      ),
    )
    return
  }
  if (segments[3] === 'files' && segments[4] === 'content' && segments.length === 5) {
    if (method === 'GET') {
      const expectedGeneration = parseExpectedGeneration({
        expectedGeneration: Number(url.searchParams.get('expectedGeneration') ?? ''),
      })
      json(
        response,
        200,
        await runtime.readFile(
          sandboxId,
          expectedGeneration,
          url.searchParams.get('path') ?? '',
          context,
        ),
      )
      return
    }
    if (method === 'PUT') {
      json(
        response,
        200,
        await runtime.writeFile(
          sandboxId,
          parseFileWriteRequest(await readJson(request, maxBodyBytes)),
          context,
        ),
      )
      return
    }
  }
  if (
    segments[3] === 'files' &&
    segments[4] === 'entries' &&
    segments.length === 5 &&
    method === 'GET'
  ) {
    const expectedGeneration = parseExpectedGeneration({
      expectedGeneration: Number(url.searchParams.get('expectedGeneration') ?? ''),
    })
    json(response, 200, {
      entries: await runtime.listFiles(
        sandboxId,
        expectedGeneration,
        url.searchParams.get('path') ?? '.',
        context,
      ),
    })
    return
  }
  throw new RuntimeError('not_found', 'route does not exist')
}
