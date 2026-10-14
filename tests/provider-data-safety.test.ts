import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  InMemorySandboxRuntime,
  MockSandboxProvider,
  RuntimeError,
  runProviderConformance,
  SandboxRuntimeClient,
  startSandboxRuntimeServer,
  type SandboxRuntimeServerHandle,
} from '../src/index.js'

const handles: SandboxRuntimeServerHandle[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
})

const start = async () => {
  let fault: { operation: string; value: unknown; observation?: boolean } | undefined
  const provider = new Proxy(new MockSandboxProvider(), {
    get(target, property) {
      if (fault?.operation === property) {
        const current = fault
        return async () => {
          if (current.observation) {
            return { state: 'failed', failure: { code: current.value, message: current.value } }
          }
          throw current.value
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'data-probe' })
  const handle = await startSandboxRuntimeServer(runtime, { port: 0 })
  handles.push(handle)
  const client = new SandboxRuntimeClient(handle.baseUrl)
  return { runtime, provider, client, handle, setFault: (value: typeof fault) => (fault = value) }
}

const operations = [
  'describe',
  'observe',
  'terminate',
  'pause',
  'resume',
  'execute',
  'readFile',
  'writeFile',
  'listFiles',
] as const
const invoke = (client: SandboxRuntimeClient, operation: (typeof operations)[number]) => {
  switch (operation) {
    case 'describe':
      return client.getRuntimeInfo()
    case 'observe':
      return client.reconcile('data-probe')
    case 'terminate':
      return client.terminate('data-probe', 1)
    case 'pause':
      return client.pause('data-probe', 1)
    case 'resume':
      return client.resume('data-probe', 1)
    case 'execute':
      return client.execute('data-probe', { expectedGeneration: 1, argv: ['synthetic-noop'] })
    case 'readFile':
      return client.readFile('data-probe', 1, 'probe.txt')
    case 'writeFile':
      return client.writeFile('data-probe', 1, 'probe.txt', Buffer.from('safe').toString('base64'))
    case 'listFiles':
      return client.listFiles('data-probe', 1)
  }
}

describe('Provider data minimization at HTTP and SDK boundaries', () => {
  it.each(
    operations.flatMap((operation) =>
      ['error', 'typed', 'non-error'].map((kind) => ({ operation, kind })),
    ),
  )('withholds $kind exception details from $operation', async ({ operation, kind }) => {
    const { client, runtime, setFault } = await start()
    await client.create({ clientRequestId: 'data-create' })
    if (operation === 'resume') await client.pause('data-probe', 1)
    const marker = `synthetic-${randomUUID()}`
    const error =
      kind === 'typed'
        ? new RuntimeError('not_found', marker)
        : kind === 'error'
          ? new Error(marker)
          : marker
    setFault({ operation, value: error })
    const result = await invoke(client, operation).catch((failure: unknown) => failure)
    expect(result).toBeInstanceOf(RuntimeError)
    expect(result).toMatchObject({
      code: kind === 'typed' ? 'not_found' : 'provider_unavailable',
      message: `provider ${operation} failed`,
    })
    expect(JSON.stringify(result)).not.toContain(marker)
    expect((result as Error).message).not.toContain(marker)
    expect(JSON.stringify(await client.get('data-probe'))).not.toContain(marker)
    expect(JSON.stringify(await client.list())).not.toContain(marker)
    expect(JSON.stringify(await client.listEvents())).not.toContain(marker)
    expect(JSON.stringify(runtime.get('data-probe'))).not.toContain(marker)
  })

  it.each(['create', 'recreate'] as const)(
    'withholds provision exception details from %s and later resource reads',
    async (action) => {
      const { client, runtime, setFault } = await start()
      if (action === 'recreate') {
        await client.create({ clientRequestId: 'data-create' })
        await client.terminate('data-probe', 1)
      }
      const marker = `synthetic-${randomUUID()}`
      setFault({ operation: 'provision', value: new Error(marker) })
      const resource =
        action === 'create'
          ? await client.create({ clientRequestId: 'data-create' })
          : await client.recreate('data-probe', 1, { clientRequestId: 'data-recreate' })
      expect(resource).toMatchObject({
        state: 'failed',
        failure: { code: 'provider_unavailable', message: 'provider operation failed' },
      })
      for (const value of [
        resource,
        runtime.get('data-probe'),
        await client.get('data-probe'),
        await client.list(),
        await client.listEvents(),
      ]) {
        expect(JSON.stringify(value)).not.toContain(marker)
      }
    },
  )

  it.each(['provision', 'observe', 'terminate', 'pause', 'resume'])(
    'normalizes returned failure code and message from %s',
    async (operation) => {
      const { client, runtime, setFault } = await start()
      if (operation !== 'provision') await client.create({ clientRequestId: 'data-create' })
      if (operation === 'resume') await client.pause('data-probe', 1)
      const marker = `synthetic-${randomUUID()}`
      setFault({ operation, value: marker, observation: true })
      const resource =
        operation === 'provision'
          ? await client.create({ clientRequestId: 'data-create' })
          : await invoke(client, operation as (typeof operations)[number])
      expect(resource).toMatchObject({
        state: 'failed',
        failure: { code: 'provider_unavailable', message: 'provider operation failed' },
      })
      expect(
        JSON.stringify([
          resource,
          runtime.get('data-probe'),
          await client.get('data-probe'),
          await client.listEvents(),
        ]),
      ).not.toContain(marker)
    },
  )

  it('normalizes an invalid RuntimeError code instead of disclosing its value', async () => {
    const { client, setFault } = await start()
    await client.create({ clientRequestId: 'data-create' })
    const marker = `synthetic-${randomUUID()}`
    const error = new RuntimeError('invalid_request', marker)
    Object.defineProperty(error, 'code', { value: marker })
    setFault({ operation: 'execute', value: error })
    await expect(invoke(client, 'execute')).rejects.toMatchObject({
      code: 'provider_unavailable',
      message: 'provider execute failed',
    })
  })

  it('keeps intentionally returned command output intact', async () => {
    const { client } = await start()
    await client.create({ clientRequestId: 'data-create' })
    const marker = `synthetic-${randomUUID()}`
    const result = await client.execute('data-probe', { expectedGeneration: 1, argv: [marker] })
    expect(result.stdout).toContain(marker)
  })

  it('preserves a portable failure code but not the Provider message', async () => {
    const { client, setFault } = await start()
    setFault({ operation: 'provision', value: 'not_found', observation: true })
    expect(await client.create({ clientRequestId: 'data-create' })).toMatchObject({
      state: 'failed',
      failure: { code: 'not_found', message: 'provider operation failed' },
    })
  })

  it('does not reflect an invalid Provider state in an HTTP validation error', async () => {
    const marker = `synthetic-${randomUUID()}`
    class StateProbe extends MockSandboxProvider {
      override async provision() {
        return { state: marker as 'ready' }
      }
    }
    const runtime = new InMemorySandboxRuntime(new StateProbe(), { idFactory: () => 'state-probe' })
    const handle = await startSandboxRuntimeServer(runtime, { port: 0 })
    handles.push(handle)
    const client = new SandboxRuntimeClient(handle.baseUrl)
    await expect(client.create({ clientRequestId: 'state-create' })).rejects.toMatchObject({
      code: 'provider_protocol_error',
      message: 'provider attempted an invalid state transition',
    })
    expect(JSON.stringify(runtime.get('state-probe'))).not.toContain(marker)
  })

  it('rejects credentials embedded in Provider endpoint metadata before storage', async () => {
    class EndpointProbe extends MockSandboxProvider {
      override async provision() {
        return { state: 'ready' as const, endpoint: { baseUrl: 'https://example.test:443/path' } }
      }
    }
    const provider = new EndpointProbe()
    const marker = `synthetic-${randomUUID()}`
    provider.provision = async () => ({
      state: 'ready',
      endpoint: { baseUrl: `https://fixture:${marker}@example.test/path` },
    })
    const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'endpoint-probe' })
    await expect(
      runtime.create({ clientRequestId: 'endpoint-create' }, { requestId: 'endpoint' }),
    ).rejects.toMatchObject({ code: 'provider_protocol_error' })
    expect(JSON.stringify(runtime.get('endpoint-probe'))).not.toContain(marker)
  })

  it.each([...operations, 'provision'])(
    'withholds %s exception details from conformance reports',
    async (operation) => {
      const { provider, setFault } = await start()
      const marker = `synthetic-${randomUUID()}`
      setFault({ operation, value: new Error(marker) })
      const results = await runProviderConformance(provider, {
        commandRequest: { argv: ['synthetic-noop'] },
        operationTimeoutMs: 100,
        cleanupTimeoutMs: 100,
        readinessTimeoutMs: 100,
        pollIntervalMs: 1,
      })
      expect(results.some((result) => !result.passed)).toBe(true)
      expect(JSON.stringify(results)).not.toContain(marker)
    },
  )
})
