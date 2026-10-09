import { describe, expect, it } from 'vitest'
import type { SandboxProvider } from '../src/provider.js'
import {
  InMemorySandboxRuntime,
  MockSandboxProvider,
  runProviderConformance,
} from '../src/index.js'

const context = { requestId: 'test' }

describe('InMemorySandboxRuntime lifecycle', () => {
  it('creates one ready sandbox idempotently', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      idFactory: () => 'sandbox-1',
      clock: () => new Date('2026-09-01T00:00:00.000Z'),
    })
    const spec = { clientRequestId: 'create-1' }
    const first = await runtime.create(spec, context)
    const second = await runtime.create(spec, context)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ id: 'sandbox-1', generation: 1, state: 'ready' })
    expect(runtime.list()).toHaveLength(1)
  })

  it('coalesces concurrent creates with the same intent', async () => {
    let provisions = 0
    const base = new MockSandboxProvider()
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: async (request, ctx) => {
        provisions += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return base.provision(request, ctx)
      },
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
    }
    const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'sandbox-1' })
    const resources = await Promise.all(
      Array.from({ length: 100 }, () => runtime.create({ clientRequestId: 'same' }, context)),
    )
    expect(new Set(resources.map((resource) => resource.id))).toEqual(new Set(['sandbox-1']))
    expect(provisions).toBe(1)
  })

  it('rejects a conflicting intent while the original create is in flight', async () => {
    const base = new MockSandboxProvider()
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: async (request, ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return base.provision(request, ctx)
      },
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
    }
    const runtime = new InMemorySandboxRuntime(provider)
    const original = runtime.create(
      { clientRequestId: 'same', extensions: { 'test.variant': 'a' } },
      context,
    )
    await expect(
      runtime.create({ clientRequestId: 'same', extensions: { 'test.variant': 'b' } }, context),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })
    await expect(original).resolves.toMatchObject({ state: 'ready' })
  })

  it('rejects reused idempotency keys with different nested intent', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider())
    await runtime.create(
      { clientRequestId: 'same', extensions: { 'test.profile': { memoryMiB: 512 } } },
      context,
    )
    await expect(
      runtime.create(
        { clientRequestId: 'same', extensions: { 'test.profile': { memoryMiB: 1024 } } },
        context,
      ),
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

  it.each([
    { clientRequestId: '' },
    { clientRequestId: 'both', image: 'a', template: 'b' },
    { clientRequestId: 'cpu', resources: { cpuMillis: 0 } },
    { clientRequestId: 'duplicates', requiredCapabilities: ['fileAccess', 'fileAccess'] as const },
  ])('validates malformed create intent %#', async (spec) => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider())
    await expect(runtime.create(spec, context)).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('fails provider-specific source and resource semantics before allocation', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider())
    await expect(
      runtime.create({ clientRequestId: 'image', image: 'public/image' }, context),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    await expect(
      runtime.create({ clientRequestId: 'template', template: 'public-template' }, context),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    await expect(
      runtime.create({ clientRequestId: 'resource', resources: { memoryMiB: 128 } }, context),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(runtime.list()).toHaveLength(0)
  })

  it('rejects non-JSON and cyclic extension values', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider())
    await expect(
      runtime.create(
        { clientRequestId: 'date', extensions: { 'test.value': new Date() } as never },
        context,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' })
    const cyclic: Record<string, unknown> = {}
    cyclic['test.self'] = cyclic
    await expect(
      runtime.create({ clientRequestId: 'cycle', extensions: cyclic as never }, context),
    ).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(
      runtime.create(
        { clientRequestId: 'unnamespaced', extensions: { value: true } as never },
        context,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('pauses, resumes, terminates, recreates, and fences stale generations', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      idFactory: () => 'sandbox-1',
    })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    expect((await runtime.pause('sandbox-1', 1, context)).state).toBe('paused')
    expect((await runtime.resume('sandbox-1', 1, context)).state).toBe('ready')
    expect((await runtime.terminate('sandbox-1', 1, context)).state).toBe('terminated')
    const recreated = await runtime.recreate(
      'sandbox-1',
      1,
      { clientRequestId: 'create-2' },
      context,
    )
    expect(recreated).toMatchObject({ id: 'sandbox-1', generation: 2, state: 'ready' })
    expect(
      await runtime.recreate('sandbox-1', 1, { clientRequestId: 'create-2' }, context),
    ).toEqual(recreated)
    await expect(runtime.create({ clientRequestId: 'create-1' }, context)).rejects.toMatchObject({
      code: 'idempotency_conflict',
    })
    await expect(runtime.terminate('sandbox-1', 1, context)).rejects.toMatchObject({
      code: 'generation_conflict',
    })
    expect((await runtime.terminate('sandbox-1', 2, context)).state).toBe('terminated')
  })

  it('serializes concurrent termination and calls the provider once', async () => {
    let terminations = 0
    const base = new MockSandboxProvider()
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: (request, ctx) => base.provision(request, ctx),
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: async (key, ctx) => {
        terminations += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return base.terminate(key, ctx)
      },
    }
    const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    const results = await Promise.all([
      runtime.terminate('sandbox-1', 1, context),
      runtime.terminate('sandbox-1', 1, context),
    ])
    expect(results.every((resource) => resource.state === 'terminated')).toBe(true)
    expect(terminations).toBe(1)
  })

  it.each(['pausing', 'resuming'] as const)(
    'terminates from %s after a lost response while fencing stale generations',
    async (state) => {
      const base = new MockSandboxProvider()
      let terminations = 0
      const provider: SandboxProvider = {
        describe: (ctx) => base.describe(ctx),
        provision: (request, ctx) => base.provision(request, ctx),
        observe: (key, ctx) => base.observe(key, ctx),
        terminate: (key, ctx) => {
          terminations += 1
          return base.terminate(key, ctx)
        },
        pause: async (key, ctx) => {
          const observation = await base.pause(key, ctx)
          if (state === 'pausing') throw new Error('pause response lost')
          return observation
        },
        resume: async (key, ctx) => {
          await base.resume(key, ctx)
          throw new Error('resume response lost')
        },
      }
      const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'sandbox-1' })
      await runtime.create({ clientRequestId: 'transition-cleanup' }, context)
      if (state === 'resuming') await runtime.pause('sandbox-1', 1, context)
      const transition = state === 'pausing' ? 'pause' : 'resume'
      await expect(runtime[transition]('sandbox-1', 1, context)).rejects.toMatchObject({
        code: 'provider_unavailable',
      })
      expect(runtime.get('sandbox-1').state).toBe(state)
      await expect(runtime.terminate('sandbox-1', 2, context)).rejects.toMatchObject({
        code: 'generation_conflict',
      })
      expect(terminations).toBe(0)
      const resources = await Promise.all([
        runtime.terminate('sandbox-1', 1, context),
        runtime.terminate('sandbox-1', 1, context),
      ])
      expect(resources.every((resource) => resource.state === 'terminated')).toBe(true)
      expect(terminations).toBe(1)
    },
  )

  it('retries termination while the provider still reports terminating', async () => {
    const base = new MockSandboxProvider()
    let terminations = 0
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: (request, ctx) => base.provision(request, ctx),
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => {
        terminations += 1
        return terminations === 1
          ? Promise.resolve({ state: 'terminating' })
          : base.terminate(key, ctx)
      },
    }
    const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'termination-retry' }, context)
    expect((await runtime.terminate('sandbox-1', 1, context)).state).toBe('terminating')
    expect((await runtime.terminate('sandbox-1', 1, context)).state).toBe('terminated')
    expect(terminations).toBe(2)
  })

  it('reconciles ambiguous pause and resume failures from transitional state', async () => {
    const base = new MockSandboxProvider()
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: (request, ctx) => base.provision(request, ctx),
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
      pause: async (key, ctx) => {
        await base.pause(key, ctx)
        throw new Error('pause response lost')
      },
      resume: async (key, ctx) => {
        await base.resume(key, ctx)
        throw new Error('resume response lost')
      },
    }
    const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    await expect(runtime.pause('sandbox-1', 1, context)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
    expect(runtime.get('sandbox-1').state).toBe('pausing')
    expect((await runtime.reconcile('sandbox-1', context)).state).toBe('paused')
    await expect(runtime.resume('sandbox-1', 1, context)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
    expect(runtime.get('sandbox-1').state).toBe('resuming')
    expect((await runtime.reconcile('sandbox-1', context)).state).toBe('ready')
  })

  it('preserves protocol errors from malformed provision observations', async () => {
    const base = new MockSandboxProvider()
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: () => Promise.resolve({ state: 'paused' }),
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
    }
    const runtime = new InMemorySandboxRuntime(provider)
    await expect(
      runtime.create({ clientRequestId: 'bad-provider' }, context),
    ).rejects.toMatchObject({
      code: 'provider_protocol_error',
    })
    expect(runtime.list()).toContainEqual(expect.objectContaining({ state: 'starting' }))
  })

  it('normalizes Provider describe failures and rejects incomplete manifests', async () => {
    const unavailable: SandboxProvider = {
      describe: () => Promise.reject(new Error('offline')),
      provision: () => Promise.resolve({ state: 'ready' }),
      observe: () => Promise.resolve({ state: 'ready' }),
      terminate: () => Promise.resolve({ state: 'terminated' }),
    }
    await expect(new InMemorySandboxRuntime(unavailable).info(context)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })

    const malformed: SandboxProvider = {
      describe: () =>
        Promise.resolve({ name: '', version: '', runtimeClass: '', capabilities: {} } as never),
      provision: () => Promise.resolve({ state: 'ready' }),
      observe: () => Promise.resolve({ state: 'ready' }),
      terminate: () => Promise.resolve({ state: 'terminated' }),
    }
    await expect(new InMemorySandboxRuntime(malformed).info(context)).rejects.toMatchObject({
      code: 'provider_protocol_error',
    })
  })
})

describe('execution, files, and events', () => {
  it('rejects malformed provider data-plane results', async () => {
    const base = new MockSandboxProvider()
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: (request, ctx) => base.provision(request, ctx),
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
      execute: () => Promise.resolve({ exitCode: 0 } as never),
      readFile: () => Promise.resolve({ path: 'probe.txt', contentBase64: 'YQ==', size: 2 }),
      writeFile: () => Promise.resolve({ path: 'other.txt', contentBase64: 'YQ==', size: 1 }),
      listFiles: () => Promise.resolve([{ path: '', kind: 'file', size: -1 }]),
    }
    const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    await expect(
      runtime.execute('sandbox-1', { expectedGeneration: 1, argv: ['probe'] }, context),
    ).rejects.toMatchObject({ code: 'provider_protocol_error' })
    await expect(runtime.readFile('sandbox-1', 1, 'probe.txt', context)).rejects.toMatchObject({
      code: 'provider_protocol_error',
    })
    await expect(
      runtime.writeFile(
        'sandbox-1',
        { expectedGeneration: 1, path: 'probe.txt', contentBase64: 'YQ==' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'provider_protocol_error' })
    await expect(runtime.listFiles('sandbox-1', 1, '.', context)).rejects.toMatchObject({
      code: 'provider_protocol_error',
    })
  })

  it('rechecks data-plane readiness after asynchronous capability lookup', async () => {
    const base = new MockSandboxProvider()
    let describeCalls = 0
    let releaseCapabilityLookup = () => {}
    let markCapabilityLookupStarted = () => {}
    const capabilityLookupGate = new Promise<void>((resolve) => {
      releaseCapabilityLookup = resolve
    })
    const capabilityLookupStarted = new Promise<void>((resolve) => {
      markCapabilityLookupStarted = resolve
    })
    const provider: SandboxProvider = {
      describe: async (ctx) => {
        describeCalls += 1
        if (describeCalls === 2) {
          markCapabilityLookupStarted()
          await capabilityLookupGate
        }
        return base.describe(ctx)
      },
      provision: (request, ctx) => base.provision(request, ctx),
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
      execute: (key, request, ctx) => base.execute(key, request, ctx),
    }
    const runtime = new InMemorySandboxRuntime(provider, { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)

    const execution = runtime.execute(
      'sandbox-1',
      { expectedGeneration: 1, argv: ['serialized'] },
      context,
    )
    await capabilityLookupStarted
    const termination = runtime.terminate('sandbox-1', 1, context)
    await expect(termination).resolves.toMatchObject({ state: 'terminated' })

    releaseCapabilityLookup()
    await expect(execution).rejects.toMatchObject({ code: 'invalid_state' })
    expect(runtime.events().map((event) => event.type)).toEqual([
      'sandbox.created',
      'sandbox.state_changed',
      'sandbox.state_changed',
      'sandbox.state_changed',
      'sandbox.state_changed',
    ])
  })

  it.each([
    { expectedGeneration: 1, argv: [] },
    { expectedGeneration: 1, argv: ['ok'], timeoutSeconds: 0 },
    { expectedGeneration: 1, argv: ['ok'], maxOutputBytes: 0 },
    { expectedGeneration: 1, argv: ['ok'], env: { 'bad-name': 'value' } },
  ])('rejects invalid portable command request %#', async (request) => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      idFactory: () => 'sandbox-1',
    })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    await expect(runtime.execute('sandbox-1', request, context)).rejects.toMatchObject({
      code: 'invalid_request',
    })
  })

  it('records monotonic replayable lifecycle and data-plane events', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      idFactory: () => 'sandbox-1',
    })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    await runtime.execute(
      'sandbox-1',
      { expectedGeneration: 1, argv: ['printf', 'hello'] },
      context,
    )
    await runtime.writeFile(
      'sandbox-1',
      {
        expectedGeneration: 1,
        path: 'hello.txt',
        contentBase64: Buffer.from('hello').toString('base64'),
      },
      context,
    )
    const events = runtime.events()
    expect(events.map((event) => event.cursor)).toEqual(events.map((_event, index) => index + 1))
    expect(events.map((event) => event.type)).toEqual([
      'sandbox.created',
      'sandbox.state_changed',
      'sandbox.state_changed',
      'sandbox.command_completed',
      'sandbox.file_written',
    ])
    expect(runtime.events(3).map((event) => event.cursor)).toEqual([4, 5])
    expect(runtime.events(0, 'other')).toEqual([])
  })

  it('round-trips mock files and lists them', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      idFactory: () => 'sandbox-1',
    })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    const contentBase64 = Buffer.from('portable').toString('base64')
    await runtime.writeFile(
      'sandbox-1',
      { expectedGeneration: 1, path: 'probe.txt', contentBase64 },
      context,
    )
    expect(await runtime.readFile('sandbox-1', 1, 'probe.txt', context)).toMatchObject({
      contentBase64,
      size: 8,
    })
    expect(await runtime.listFiles('sandbox-1', 1, '.', context)).toEqual([
      { path: 'probe.txt', kind: 'file', size: 8 },
    ])
    await runtime.writeFile(
      'sandbox-1',
      { expectedGeneration: 1, path: 'nested/probe.txt', contentBase64 },
      context,
    )
    expect(await runtime.listFiles('sandbox-1', 1, '.', context)).toEqual([
      { path: 'probe.txt', kind: 'file', size: 8 },
    ])
    expect(await runtime.listFiles('sandbox-1', 1, 'nested', context)).toEqual([
      { path: 'nested/probe.txt', kind: 'file', size: 8 },
    ])
  })

  it('notifies and unsubscribes event listeners', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider())
    const cursors: number[] = []
    const unsubscribe = runtime.subscribe((event) => cursors.push(event.cursor))
    await runtime.create({ clientRequestId: 'first' }, context)
    unsubscribe()
    await runtime.create({ clientRequestId: 'second' }, context)
    expect(cursors).toEqual([1, 2, 3])
  })

  it('isolates lifecycle operations from subscriber failures', async () => {
    const listenerErrors: string[] = []
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), {
      listenerErrorHandler: (error) =>
        listenerErrors.push(error instanceof Error ? error.message : 'unknown'),
    })
    runtime.subscribe(() => {
      throw new Error('subscriber failed')
    })
    const observed: number[] = []
    runtime.subscribe((event) => observed.push(event.cursor))

    const resource = await runtime.create({ clientRequestId: 'listener' }, context)
    expect(resource.state).toBe('ready')
    expect(observed).toEqual([1, 2, 3])
    expect(listenerErrors).toEqual(['subscriber failed', 'subscriber failed', 'subscriber failed'])
  })

  it('bounds event history and rejects stale replay cursors', async () => {
    const runtime = new InMemorySandboxRuntime(new MockSandboxProvider(), { maxEvents: 2 })
    await runtime.create({ clientRequestId: 'bounded' }, context)
    expect(runtime.events().map((event) => event.cursor)).toEqual([2, 3])
    expect(() => runtime.events(1)).not.toThrow()
    const [resource] = runtime.list()
    if (!resource) throw new Error('sandbox was not created')
    await runtime.execute(resource.id, { expectedGeneration: 1, argv: ['ok'] }, context)
    expect(() => runtime.events(1)).toThrowError(/starts at cursor 3/)
  })
})

describe('provider conformance', () => {
  it('accepts the deterministic mock provider', async () => {
    const results = await runProviderConformance(new MockSandboxProvider(), {
      commandRequest: { argv: ['conformance'] },
    })
    expect(results.filter((result) => !result.passed)).toEqual([])
  })

  it('isolates concurrent conformance runs with unique resource identities', async () => {
    const base = new MockSandboxProvider()
    const sandboxIds: string[] = []
    const createIntents: string[] = []
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: async (request, ctx) => {
        sandboxIds.push(request.sandboxId)
        createIntents.push(request.spec.clientRequestId)
        await Promise.resolve()
        return base.provision(request, ctx)
      },
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
      pause: (key, ctx) => base.pause(key, ctx),
      resume: (key, ctx) => base.resume(key, ctx),
      execute: (key, request, ctx) => base.execute(key, request, ctx),
      readFile: (key, path, ctx) => base.readFile(key, path, ctx),
      writeFile: (key, request, ctx) => base.writeFile(key, request, ctx),
      listFiles: (key, path, ctx) => base.listFiles(key, path, ctx),
    }
    const runs = await Promise.all([
      runProviderConformance(provider, { commandRequest: { argv: ['first'] } }),
      runProviderConformance(provider, { commandRequest: { argv: ['second'] } }),
    ])
    expect(new Set(sandboxIds).size).toBe(2)
    expect(new Set(createIntents).size).toBe(2)
    expect(runs.flat().filter((result) => !result.passed)).toEqual([])
  })

  it('detects a capability without its SPI method', async () => {
    const base = new MockSandboxProvider()
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: (request, ctx) => base.provision(request, ctx),
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
    }
    const results = await runProviderConformance(provider, {
      commandRequest: { argv: ['conformance'] },
    })
    expect(results.some((result) => !result.passed)).toBe(true)
  })

  it('accepts a provider that becomes ready asynchronously', async () => {
    const base = new MockSandboxProvider({ pauseResume: false, fileAccess: false })
    let observations = 0
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: () => Promise.resolve({ state: 'starting' }),
      observe: () => {
        observations += 1
        return Promise.resolve({ state: 'ready' })
      },
      terminate: () => Promise.resolve({ state: 'terminated' }),
      execute: (_key, request) => {
        if (observations === 0) throw new Error('execute ran before readiness')
        const now = new Date().toISOString()
        return Promise.resolve({
          exitCode: 0,
          stdout: request.argv.join(' '),
          stderr: '',
          timedOut: false,
          cancelled: false,
          truncated: false,
          startedAt: now,
          finishedAt: now,
        })
      },
    }
    await expect(
      runProviderConformance(provider, { commandRequest: { argv: ['conformance'] } }),
    ).resolves.not.toContainEqual(expect.objectContaining({ passed: false }))
  })

  it('attempts cleanup when the provision response is lost', async () => {
    const base = new MockSandboxProvider({ pauseResume: false, fileAccess: false })
    let terminations = 0
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: () => Promise.reject(new Error('response lost')),
      observe: () => Promise.resolve({ state: 'ready' }),
      terminate: () => {
        terminations += 1
        return Promise.resolve({ state: 'terminated' })
      },
      execute: (key, request, ctx) => base.execute(key, request, ctx),
    }
    const results = await runProviderConformance(provider)
    expect(terminations).toBe(1)
    expect(results).toContainEqual({
      name: 'ambiguous provision failure is cleaned up',
      passed: true,
    })
  })

  it('bounds a readiness observation that never settles and still cleans up', async () => {
    const base = new MockSandboxProvider({
      commandExecution: false,
      fileAccess: false,
      pauseResume: false,
    })
    let terminations = 0
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: () => Promise.resolve({ state: 'starting' }),
      observe: () => new Promise(() => {}),
      terminate: () => {
        terminations += 1
        return Promise.resolve({ state: 'terminated' })
      },
    }
    const startedAt = Date.now()
    const results = await runProviderConformance(provider, {
      readinessTimeoutMs: 20,
      pollIntervalMs: 5,
    })
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(terminations).toBe(1)
    expect(results).toContainEqual({
      name: 'provision reaches ready within the bounded deadline',
      passed: false,
      detail: 'readiness observation timed out',
    })
  })

  it('rejects incomplete command result shapes', async () => {
    const base = new MockSandboxProvider({ pauseResume: false, fileAccess: false })
    const provider: SandboxProvider = {
      describe: (ctx) => base.describe(ctx),
      provision: (request, ctx) => base.provision(request, ctx),
      observe: (key, ctx) => base.observe(key, ctx),
      terminate: (key, ctx) => base.terminate(key, ctx),
      execute: () => Promise.resolve({ exitCode: 0, timedOut: false } as never),
    }
    const results = await runProviderConformance(provider, {
      commandRequest: { argv: ['incomplete'] },
    })
    expect(results).toContainEqual({
      name: 'command execution returns a complete successful result',
      passed: false,
    })
  })

  it('reports unreadable and incomplete manifests without throwing', async () => {
    const unreadable: SandboxProvider = {
      describe: () => Promise.reject(new Error('offline')),
      provision: () => Promise.resolve({ state: 'ready' }),
      observe: () => Promise.resolve({ state: 'ready' }),
      terminate: () => Promise.resolve({ state: 'terminated' }),
    }
    await expect(runProviderConformance(unreadable)).resolves.toContainEqual({
      name: 'provider manifest is readable',
      passed: false,
      detail: 'offline',
    })

    const incomplete: SandboxProvider = {
      describe: () =>
        Promise.resolve({ name: '', version: '', runtimeClass: '', capabilities: {} } as never),
      provision: () => Promise.resolve({ state: 'ready' }),
      observe: () => Promise.resolve({ state: 'ready' }),
      terminate: () => Promise.resolve({ state: 'terminated' }),
    }
    await expect(runProviderConformance(incomplete)).resolves.toEqual([
      { name: 'provider manifest is complete', passed: false },
    ])
  })
})
