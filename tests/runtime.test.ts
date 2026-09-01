import { describe, expect, it } from 'vitest'
import {
  InMemorySandboxRuntime,
  MockSandboxProvider,
  RuntimeError,
  runProviderConformance,
} from '../src/index.js'

const context = { requestId: 'test' }

describe('InMemorySandboxRuntime', () => {
  it('creates one ready sandbox idempotently', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      idFactory: () => 'sandbox-1',
      clock: () => new Date('2026-09-01T00:00:00.000Z'),
    })
    const spec = { clientRequestId: 'create-1', image: 'public.example/sandbox:latest' }

    const first = await runtime.create(spec, context)
    const second = await runtime.create(spec, context)

    expect(first).toEqual(second)
    expect(first).toMatchObject({ id: 'sandbox-1', generation: 1, state: 'ready' })
    expect(runtime.list()).toHaveLength(1)
  })

  it('rejects one idempotency key with different intent', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider())
    await runtime.create({ clientRequestId: 'same', image: 'public.example/a:latest' }, context)

    await expect(
      runtime.create({ clientRequestId: 'same', image: 'public.example/b:latest' }, context),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })
  })

  it('detects idempotency conflicts inside nested specifications', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider())
    await runtime.create({ clientRequestId: 'nested', resources: { memoryMiB: 512 } }, context)

    await expect(
      runtime.create({ clientRequestId: 'nested', resources: { memoryMiB: 1024 } }, context),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })
  })

  it('fails unsupported capabilities before allocation', async () => {
    const runtime = new InMemorySandboxRuntime(
      new MockSandboxProvider({ interactiveTerminal: false }),
    )

    await expect(
      runtime.create(
        { clientRequestId: 'terminal', requiredCapabilities: ['interactiveTerminal'] },
        context,
      ),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(runtime.list()).toHaveLength(0)
  })

  it('fences termination with the observed generation', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      idFactory: () => 'sandbox-1',
    })
    await runtime.create({ clientRequestId: 'create-1' }, context)

    await expect(runtime.terminate('sandbox-1', 2, context)).rejects.toBeInstanceOf(RuntimeError)
    const terminated = await runtime.terminate('sandbox-1', 1, context)
    expect(terminated.state).toBe('terminated')
  })

  it('pauses and resumes only through declared provider behavior', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      idFactory: () => 'sandbox-1',
    })
    await runtime.create({ clientRequestId: 'create-1' }, context)

    expect((await runtime.pause('sandbox-1', 1, context)).state).toBe('paused')
    expect((await runtime.resume('sandbox-1', 1, context)).state).toBe('ready')
  })
})

describe('provider conformance', () => {
  it('accepts the deterministic mock provider', async () => {
    const results = await runProviderConformance(new MockSandboxProvider())
    expect(results).not.toHaveLength(0)
    expect(results.every((result) => result.passed)).toBe(true)
  })
})
