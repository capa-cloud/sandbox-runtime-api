import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  InMemorySandboxRuntime,
  MockSandboxProvider,
  startSandboxRuntimeServer,
  type SandboxRuntimeServerHandle,
} from '../src/index.js'

const handles: SandboxRuntimeServerHandle[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
})

const start = async () => {
  const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
    idFactory: () => 'boundary-probe',
  })
  const handle = await startSandboxRuntimeServer(runtime, { port: 0 })
  handles.push(handle)
  return { runtime, handle }
}

const rawRequest = (
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const pending = request(
      url,
      { headers, method: body === undefined ? 'GET' : 'POST' },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          text += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text }))
        response.on('error', reject)
      },
    )
    pending.setTimeout(2_000, () => pending.destroy(new Error('synthetic request timed out')))
    pending.on('error', reject)
    pending.end(body)
  })

describe('reference server browser and route boundaries', () => {
  it.each([
    { origin: 'http://example.test' },
    { origin: 'null' },
    { referer: 'http://example.test/page' },
    { referer: 'not-a-url' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { host: 'example.test:4311' },
    { host: '127.0.0.1:1' },
  ])('rejects unsafe browser/authority headers %# before mutations', async (headers) => {
    const { handle, runtime } = await start()
    const response = await rawRequest(
      `${handle.baseUrl}/v1/sandboxes`,
      { 'content-type': 'application/json', ...headers },
      JSON.stringify({ clientRequestId: 'blocked' }),
    )
    expect(response.status).toBe(400)
    expect(runtime.list()).toEqual([])
    expect(runtime.events()).toEqual([])
  })

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'])(
    'rejects JSON sent as %s',
    async (contentType) => {
      const { handle, runtime } = await start()
      const response = await fetch(`${handle.baseUrl}/v1/sandboxes`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: JSON.stringify({ clientRequestId: 'simple-request' }),
      })
      expect(response.status).toBe(400)
      expect(runtime.list()).toEqual([])
    },
  )

  it('accepts same-origin JSON requests and non-browser clients', async () => {
    const { handle } = await start()
    const response = await fetch(`${handle.baseUrl}/v1/sandboxes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        origin: handle.baseUrl,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ clientRequestId: 'same-origin' }),
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await fetch(`${handle.baseUrl}/healthz`)).status).toBe(200)
  })

  it('rejects hostile read requests without disclosing resources', async () => {
    const { handle, runtime } = await start()
    await runtime.create({ clientRequestId: 'private-probe' }, { requestId: 'synthetic' })
    for (const path of ['/v1/runtime', '/v1/sandboxes', '/v1/events', '/v1/events/stream']) {
      const response = await rawRequest(`${handle.baseUrl}${path}`, { host: 'example.test:4311' })
      expect(response.status).toBe(400)
      expect(response.text).not.toContain('private-probe')
    }
  })

  it('allows a loopback alias with the actual port and matching referrer', async () => {
    const { handle } = await start()
    const authority = `localhost:${new URL(handle.baseUrl).port}`
    const response = await rawRequest(`${handle.baseUrl}/healthz`, {
      host: authority,
      referer: `http://${authority}/synthetic-page`,
    })
    expect(response.status).toBe(200)
  })

  it('sanitizes unexpected implementation errors', async () => {
    const { handle, runtime } = await start()
    runtime.list = () => {
      throw new Error('synthetic implementation detail')
    }
    const response = await fetch(`${handle.baseUrl}/v1/sandboxes`)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('synthetic implementation detail')
  })

  it.each([
    'actions/terminate/extra',
    'commands/extra',
    'files/content/extra',
    'files/entries/extra',
    'actions/terminate/',
    'actions/terminate//extra',
    'actions//terminate',
    'files//entries',
  ])('does not route extra path components for %s', async (suffix) => {
    const { handle, runtime } = await start()
    await runtime.create({ clientRequestId: 'routes' }, { requestId: 'synthetic' })
    const method = suffix.startsWith('files/') ? 'GET' : 'POST'
    const response = await fetch(
      `${handle.baseUrl}/v1/sandboxes/boundary-probe/${suffix}?expectedGeneration=1&path=probe.txt`,
      {
        method,
        ...(method === 'POST'
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ expectedGeneration: 1 }),
            }
          : {}),
      },
    )
    expect(response.status).toBe(404)
    expect(runtime.get('boundary-probe').state).toBe('ready')
  })

  it('returns a portable validation error for malformed path encoding', async () => {
    const { handle } = await start()
    const response = await fetch(`${handle.baseUrl}/v1/sandboxes/%E0%A4%A`)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_request' } })
  })
})
