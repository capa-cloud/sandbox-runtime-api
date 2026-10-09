import { describe, expect, it, vi } from 'vitest'
import { MockSandboxProvider, runProviderConformance } from '../src/index.js'
import type { ProviderContext, SandboxProvider } from '../src/provider.js'

const fixture = (): SandboxProvider => {
  const base = new MockSandboxProvider()
  return {
    describe: (ctx) => base.describe(ctx),
    provision: (request, ctx) => base.provision(request, ctx),
    observe: (key, ctx) => base.observe(key, ctx),
    terminate: (key, ctx) => base.terminate(key, ctx),
    pause: (key, ctx) => base.pause(key, ctx),
    resume: (key, ctx) => base.resume(key, ctx),
    execute: (key, request, ctx) => base.execute(key, request, ctx),
    writeFile: (key, request, ctx) => base.writeFile(key, request, ctx),
    readFile: (key, path, ctx) => base.readFile(key, path, ctx),
    listFiles: (key, path, ctx) => base.listFiles(key, path, ctx),
  }
}

describe('conformance deadlines and cleanup', () => {
  it.each([
    'describe',
    'provision',
    'observe',
    'pause',
    'resume',
    'execute',
    'writeFile',
    'readFile',
    'listFiles',
    'terminate',
  ] as const)('bounds a hung %s call and attempts cleanup when needed', async (operation) => {
    const provider = fixture()
    let terminations = 0
    let signal: AbortSignal | undefined
    const terminate = provider.terminate
    provider.terminate = (key, ctx) => {
      expect(ctx.signal?.aborted).toBe(false)
      terminations += 1
      return terminate(key, ctx)
    }
    Object.assign(provider, {
      [operation]: (...args: unknown[]) => {
        if (operation === 'terminate') terminations += 1
        signal = (args.at(-1) as ProviderContext).signal
        return new Promise(() => {})
      },
    })
    vi.useFakeTimers()
    try {
      const running = runProviderConformance(provider, {
        operationTimeoutMs: 100,
        cleanupTimeoutMs: 100,
        readinessTimeoutMs: 100,
        commandRequest: { argv: ['probe'] },
      })
      await vi.runAllTimersAsync()
      const results = await running
      expect(results.some((result) => !result.passed && result.detail?.includes('timed out'))).toBe(
        true,
      )
      expect(signal?.aborted).toBe(true)
      expect(terminations).toBe(operation === 'describe' ? 0 : 1)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('does not report cleanup success for a non-terminated observation', async () => {
    const provider = fixture()
    provider.provision = () => Promise.reject(new Error('response lost'))
    provider.terminate = () => Promise.resolve({ state: 'terminating' })
    const results = await runProviderConformance(provider)
    expect(results).toContainEqual(
      expect.objectContaining({ name: 'ambiguous provision failure is cleaned up', passed: false }),
    )
  })

  it('does not accept failed resume as successful recovery', async () => {
    const provider = fixture()
    provider.resume = () => Promise.resolve({ state: 'failed' })
    provider.execute = () => {
      throw new Error('data-plane probe ran after failed recovery')
    }
    const results = await runProviderConformance(provider, { commandRequest: { argv: ['probe'] } })
    expect(results).toContainEqual(
      expect.objectContaining({ name: 'resume leaves paused', passed: false }),
    )
    expect(results.some((result) => result.name.includes('command execution'))).toBe(false)
  })

  it('retains timeout diagnosis when the Provider rejects on cancellation', async () => {
    const provider = fixture()
    provider.describe = (ctx) =>
      new Promise((_resolve, reject) => {
        ctx.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
    await expect(runProviderConformance(provider, { operationTimeoutMs: 10 })).resolves.toEqual([
      { name: 'provider manifest is readable', passed: false, detail: 'describe timed out' },
    ])
  })

  it('handles a late rejection after returning a timeout result', async () => {
    const provider = fixture()
    provider.describe = () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('late failure')), 30)
      })
    const results = await runProviderConformance(provider, { operationTimeoutMs: 10 })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(results).toEqual([
      { name: 'provider manifest is readable', passed: false, detail: 'describe timed out' },
    ])
  })

  it.each(['failed', 'paused', 'not-a-state', undefined])(
    'rejects invalid provision state %s and still cleans up',
    async (state) => {
      const provider = fixture()
      let cleaned = false
      provider.provision = () => Promise.resolve({ state } as never)
      provider.terminate = async () => {
        cleaned = true
        return { state: 'terminated' }
      }
      const results = await runProviderConformance(provider)
      expect(results).toContainEqual(
        expect.objectContaining({
          name: 'provision returns an observable non-terminal state',
          passed: false,
        }),
      )
      expect(cleaned).toBe(true)
      expect(results).toContainEqual({ name: 'terminate reaches terminated', passed: true })
    },
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
    'rejects invalid timeout %s before allocating',
    async (timeout) => {
      const provider = fixture()
      provider.describe = () => {
        throw new Error('provider must not be called')
      }
      for (const option of [
        'operationTimeoutMs',
        'cleanupTimeoutMs',
        'readinessTimeoutMs',
        'pollIntervalMs',
      ]) {
        const results = await runProviderConformance(provider, { [option]: timeout })
        expect(results).toContainEqual(
          expect.objectContaining({ name: 'conformance options are valid', passed: false }),
        )
      }
    },
  )
})
