import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  InMemorySandboxRuntime,
  LocalSandboxProvider,
  MockSandboxProvider,
  RuntimeError,
  SandboxRuntimeClient,
  startSandboxRuntimeServer,
  type SandboxRuntimeServerHandle,
} from '../src/index.js'

const handles: SandboxRuntimeServerHandle[] = []
const providers: LocalSandboxProvider[] = []
const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
  await Promise.all(providers.splice(0).map((provider) => provider.dispose()))
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

const start = async () => {
  const provider = new LocalSandboxProvider()
  providers.push(provider)
  const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'sandbox-1' })
  const handle = await startSandboxRuntimeServer(runtime, { port: 0 })
  handles.push(handle)
  return { client: new SandboxRuntimeClient(handle.baseUrl), handle }
}

const startMock = async () => {
  const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
    idFactory: () => 'sandbox-1',
  })
  const handle = await startSandboxRuntimeServer(runtime, { port: 0 })
  handles.push(handle)
  return { client: new SandboxRuntimeClient(handle.baseUrl), handle }
}

describe('HTTP server and TypeScript SDK', () => {
  it('runs lifecycle, command, file, event, terminate, and recreate', async () => {
    const { client } = await start()
    expect(await client.getRuntimeInfo()).toMatchObject({
      protocolVersion: '0.1',
      provider: { name: 'local', runtimeClass: 'local-process-unsafe' },
    })
    const sandbox = await client.create({
      clientRequestId: 'http-create',
      requiredCapabilities: ['commandExecution', 'fileAccess'],
    })
    expect(sandbox).toMatchObject({ id: 'sandbox-1', state: 'ready', generation: 1 })
    expect(await client.list()).toHaveLength(1)
    expect(await client.get('sandbox-1')).toEqual(sandbox)

    const contentBase64 = Buffer.from('hello').toString('base64')
    await client.writeFile('sandbox-1', 1, 'hello.txt', contentBase64)
    expect(await client.readFile('sandbox-1', 1, 'hello.txt')).toMatchObject({
      contentBase64,
      size: 5,
    })
    expect(await client.listFiles('sandbox-1', 1)).toContainEqual({
      path: 'hello.txt',
      kind: 'file',
      size: 5,
    })
    expect(
      await client.execute('sandbox-1', {
        expectedGeneration: 1,
        argv: [process.execPath, '-e', 'process.stdout.write("hello")'],
      }),
    ).toMatchObject({ exitCode: 0, stdout: 'hello', timedOut: false })
    expect((await client.listEvents()).at(-1)?.type).toBe('sandbox.command_completed')
    expect((await client.terminate('sandbox-1', 1)).state).toBe('terminated')
    const recreated = await client.recreate('sandbox-1', 1, {
      clientRequestId: 'http-recreate',
    })
    expect(recreated).toMatchObject({ state: 'ready', generation: 2 })
    await expect(
      client.writeFile('sandbox-1', 1, 'stale.txt', contentBase64),
    ).rejects.toMatchObject({
      code: 'generation_conflict',
    })
    await expect(
      client.execute('sandbox-1', { expectedGeneration: 1, argv: ['printf', 'stale'] }),
    ).rejects.toMatchObject({ code: 'generation_conflict' })
    await expect(client.readFile('sandbox-1', 1, 'stale.txt')).rejects.toMatchObject({
      code: 'generation_conflict',
    })
    await expect(client.listFiles('sandbox-1', 1)).rejects.toMatchObject({
      code: 'generation_conflict',
    })
  })

  it('carries file content larger than the former one MiB HTTP limit', async () => {
    const { client } = await start()
    const sandbox = await client.create({ clientRequestId: 'large-file' })
    const content = Buffer.alloc(1024 * 1024, 0x61)
    const written = await client.writeFile(
      sandbox.id,
      sandbox.generation,
      'large.bin',
      content.toString('base64'),
    )
    expect(written.size).toBe(content.byteLength)
    expect((await client.readFile(sandbox.id, sandbox.generation, 'large.bin')).size).toBe(
      content.byteLength,
    )
  })

  it('replays events over SSE and allows the consumer to close the stream', async () => {
    const { client } = await start()
    await client.create({ clientRequestId: 'sse-create' })
    const stream = client.streamEvents({ after: 0 })
    const first = await stream.next()
    expect(first.value).toMatchObject({ cursor: 1, type: 'sandbox.created' })
    await stream.return(undefined)
  })

  it('closes the server even while an SSE client is connected', async () => {
    const { handle } = await start()
    const response = await fetch(`${handle.baseUrl}/v1/events/stream?after=0`)
    expect(response.status).toBe(200)
    handles.splice(handles.indexOf(handle), 1)
    await expect(handle.close()).resolves.toBeUndefined()
  })

  it('returns 410 before opening an SSE stream for an expired cursor', async () => {
    const provider = new MockSandboxProvider()
    const runtime = new InMemorySandboxRuntime(provider, { maxEvents: 2 })
    const handle = await startSandboxRuntimeServer(runtime, { port: 0 })
    handles.push(handle)
    await runtime.create({ clientRequestId: 'bounded' }, { requestId: 'bounded' })
    const [resource] = runtime.list()
    if (!resource) throw new Error('sandbox was not created')
    await runtime.execute(
      resource.id,
      { expectedGeneration: 1, argv: ['event'] },
      { requestId: 'event' },
    )
    const response = await fetch(`${handle.baseUrl}/v1/events/stream?after=1`)
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'event_history_unavailable' },
    })
  })

  it('projects pause, resume, and reconcile through the SDK', async () => {
    const { client } = await startMock()
    const sandbox = await client.create({
      clientRequestId: 'mock-create',
      requiredCapabilities: ['pauseResume'],
    })
    expect((await client.reconcile(sandbox.id)).state).toBe('ready')
    expect((await client.pause(sandbox.id, sandbox.generation)).state).toBe('paused')
    expect((await client.resume(sandbox.id, sandbox.generation)).state).toBe('ready')
    await expect(client.terminate(sandbox.id, 2)).rejects.toMatchObject({
      code: 'generation_conflict',
    })
  })

  it('maps runtime errors and rejects malformed JSON', async () => {
    const { client, handle } = await start()
    await expect(client.get('missing')).rejects.toMatchObject({ code: 'not_found' })
    const response = await fetch(`${handle.baseUrl}/v1/sandboxes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_request' } })
  })

  it('propagates an HTTP disconnect to the running local process group', async () => {
    const { client } = await start()
    const sandbox = await client.create({ clientRequestId: 'abort-create' })
    const markerRoot = await mkdtemp(join(tmpdir(), 'sandbox-http-abort-'))
    cleanupPaths.push(markerRoot)
    const marker = join(markerRoot, 'probe.txt')
    const script = [
      'const {spawn}=require("node:child_process")',
      `spawn(process.execPath,["-e",${JSON.stringify(`setTimeout(()=>require("node:fs").writeFileSync(${JSON.stringify(marker)},"bad"),300)`)}],{stdio:"ignore"})`,
      'setTimeout(()=>{},10000)',
    ].join(';')
    const controller = new AbortController()
    const execution = client.execute(
      sandbox.id,
      { expectedGeneration: 1, argv: [process.execPath, '-e', script], timeoutSeconds: 5 },
      controller.signal,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    controller.abort()
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(
      await access(marker)
        .then(() => true)
        .catch(() => false),
    ).toBe(false)
    await expect(
      client.execute(sandbox.id, {
        expectedGeneration: 1,
        argv: [process.execPath, '-e', 'process.stdout.write("alive")'],
      }),
    ).resolves.toMatchObject({ stdout: 'alive', exitCode: 0 })
  })

  it('does not expose parser details for malformed paths', async () => {
    const { handle } = await start()
    const response = await fetch(`${handle.baseUrl}/v1/sandboxes/%E0%A4%A`)
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('URIError')
  })

  it('returns not found for an unknown route and rejects oversized bodies', async () => {
    const provider = new LocalSandboxProvider()
    providers.push(provider)
    const runtime = new InMemorySandboxRuntime(provider)
    const handle = await startSandboxRuntimeServer(runtime, { port: 0, maxBodyBytes: 1024 })
    handles.push(handle)
    expect((await fetch(`${handle.baseUrl}/unknown`)).status).toBe(404)
    const oversized = await fetch(`${handle.baseUrl}/v1/sandboxes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientRequestId: 'large', padding: 'x'.repeat(1024) }),
    })
    expect(oversized.status).toBe(400)
  })

  it('refuses a non-loopback bind without an explicit unsafe override', async () => {
    const provider = new LocalSandboxProvider()
    providers.push(provider)
    const runtime = new InMemorySandboxRuntime(provider)
    await expect(
      startSandboxRuntimeServer(runtime, { host: '0.0.0.0', port: 0 }),
    ).rejects.toBeInstanceOf(RuntimeError)
  })

  it('normalizes unknown remote error codes', async () => {
    const fakeFetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: 'remote_private_code', message: 'failed' } }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )) as typeof fetch
    const client = new SandboxRuntimeClient('http://runtime.invalid', fakeFetch)
    await expect(client.getRuntimeInfo()).rejects.toMatchObject({
      code: 'provider_unavailable',
      message: 'failed',
    })
  })

  it('parses CRLF SSE frames split across network chunks', async () => {
    const event = {
      cursor: 1,
      type: 'sandbox.created',
      sandboxId: 'sandbox-1',
      generation: 1,
      timestamp: '2026-09-02T00:00:00.000Z',
      data: {},
    }
    const payload = `data: ${JSON.stringify(event)}`
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${payload}\r`))
        controller.enqueue(encoder.encode('\n\r'))
        controller.enqueue(encoder.encode('\n'))
        controller.close()
      },
    })
    const fakeFetch = (() =>
      Promise.resolve(
        new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      )) as typeof fetch
    const client = new SandboxRuntimeClient('http://runtime.invalid', fakeFetch)
    const events = client.streamEvents()
    await expect(events.next()).resolves.toMatchObject({ value: event, done: false })
    await events.return(undefined)
  })

  it('parses SSE frames delimited by CR-only line endings', async () => {
    const event = {
      cursor: 1,
      type: 'sandbox.created',
      sandboxId: 'sandbox-1',
      generation: 1,
      timestamp: '2026-09-02T00:00:00.000Z',
      data: {},
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\r\r`))
        controller.close()
      },
    })
    const fakeFetch = (() =>
      Promise.resolve(
        new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      )) as typeof fetch
    const client = new SandboxRuntimeClient('http://runtime.invalid', fakeFetch)
    const events = client.streamEvents()
    await expect(events.next()).resolves.toMatchObject({ value: event, done: false })
    await events.return(undefined)
  })
})
