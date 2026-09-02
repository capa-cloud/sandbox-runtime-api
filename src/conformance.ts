import { randomUUID } from 'node:crypto'
import type { ProviderObservation, SandboxProvider } from './provider.js'
import {
  capabilityNames,
  type CommandRequest,
  type CommandResult,
  type FileEntry,
  type FileReadResult,
  type ProviderManifest,
} from './protocol.js'

export type ConformanceResult = Readonly<{
  name: string
  passed: boolean
  detail?: string
}>

export type ProviderConformanceOptions = Readonly<{
  readinessTimeoutMs?: number
  pollIntervalMs?: number
  commandRequest?: Omit<CommandRequest, 'expectedGeneration'>
}>

const failure = (name: string, error: unknown): ConformanceResult => ({
  name,
  passed: false,
  detail: error instanceof Error ? error.message : 'provider failed without an error',
})

const validManifest = (manifest: ProviderManifest): boolean =>
  Boolean(
    manifest &&
      typeof manifest.name === 'string' &&
      manifest.name.trim() &&
      typeof manifest.version === 'string' &&
      manifest.version.trim() &&
      typeof manifest.runtimeClass === 'string' &&
      manifest.runtimeClass.trim() &&
      manifest.capabilities &&
      capabilityNames.every((name) => typeof manifest.capabilities[name] === 'boolean'),
  )

const validTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

const validCommandResult = (result: CommandResult): boolean =>
  Boolean(
    result &&
      (result.exitCode === null || Number.isInteger(result.exitCode)) &&
      typeof result.stdout === 'string' &&
      typeof result.stderr === 'string' &&
      typeof result.timedOut === 'boolean' &&
      typeof result.cancelled === 'boolean' &&
      typeof result.truncated === 'boolean' &&
      validTimestamp(result.startedAt) &&
      validTimestamp(result.finishedAt),
  )

const validFileResult = (result: FileReadResult, path: string, size: number): boolean =>
  Boolean(
    result &&
      result.path === path &&
      typeof result.contentBase64 === 'string' &&
      result.size === size,
  )

const validFileEntry = (entry: FileEntry): boolean =>
  Boolean(
    entry &&
      typeof entry.path === 'string' &&
      ['file', 'directory'].includes(entry.kind) &&
      Number.isInteger(entry.size) &&
      entry.size >= 0,
  )

const observeBefore = async (
  provider: SandboxProvider,
  key: Readonly<{ sandboxId: string; generation: number }>,
  requestId: string,
  deadline: number,
): Promise<ProviderObservation> => {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) throw new Error('readiness observation timed out')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      provider.observe(key, { requestId, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('readiness observation timed out'))
        }, remainingMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const runProviderConformance = async (
  provider: SandboxProvider,
  options: ProviderConformanceOptions = {},
): Promise<readonly ConformanceResult[]> => {
  const runId = randomUUID()
  const context = { requestId: `conformance-${runId}` }
  const key = { sandboxId: `conformance-${runId}`, generation: 1 }
  const results: ConformanceResult[] = []
  const readinessTimeoutMs = Math.max(1, options.readinessTimeoutMs ?? 5_000)
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 25)

  let manifest: ProviderManifest
  try {
    manifest = await provider.describe(context)
  } catch (error) {
    return [failure('provider manifest is readable', error)]
  }
  results.push({ name: 'provider manifest is complete', passed: validManifest(manifest) })
  if (!validManifest(manifest)) return results

  let provisioned: ProviderObservation
  try {
    provisioned = await provider.provision(
      { ...key, spec: { clientRequestId: 'conformance-create' } },
      context,
    )
    results.push({
      name: 'provision returns an observable non-terminal state',
      passed: !['failed', 'terminated'].includes(provisioned.state),
      ...(['failed', 'terminated'].includes(provisioned.state)
        ? { detail: `observed ${provisioned.state}` }
        : {}),
    })
  } catch (error) {
    results.push(failure('provision returns an observation', error))
    try {
      await provider.terminate(key, context)
      results.push({ name: 'ambiguous provision failure is cleaned up', passed: true })
    } catch (cleanupError) {
      results.push(failure('ambiguous provision failure is cleaned up', cleanupError))
    }
    return results
  }

  let ready = false
  try {
    const deadline = Date.now() + readinessTimeoutMs
    let observed = await observeBefore(provider, key, context.requestId, deadline)
    while (!['ready', 'failed', 'terminated'].includes(observed.state) && Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))),
      )
      observed = await observeBefore(provider, key, context.requestId, deadline)
    }
    ready = observed.state === 'ready'
    results.push({
      name: 'provision reaches ready within the bounded deadline',
      passed: ready,
      ...(!ready ? { detail: `last observed state ${observed.state}` } : {}),
    })
  } catch (error) {
    results.push(failure('provision reaches ready within the bounded deadline', error))
  }

  if (ready && manifest.capabilities.pauseResume) {
    if (!provider.pause || !provider.resume) {
      results.push({
        name: 'pauseResume capability has SPI methods',
        passed: false,
        detail: 'manifest declares pauseResume without pause and resume methods',
      })
    } else {
      try {
        const paused = await provider.pause(key, context)
        results.push({ name: 'pause reaches paused', passed: paused.state === 'paused' })
        const resumed = await provider.resume(key, context)
        results.push({ name: 'resume leaves paused', passed: resumed.state !== 'paused' })
      } catch (error) {
        results.push(failure('pause and resume complete', error))
      }
    }
  }

  if (ready && manifest.capabilities.commandExecution) {
    if (!provider.execute) {
      results.push({ name: 'commandExecution capability has an execute method', passed: false })
    } else if (!options.commandRequest) {
      results.push({
        name: 'command execution probe is configured',
        passed: false,
        detail: 'commandRequest is required because no command is portable across providers',
      })
    } else {
      try {
        const command = await provider.execute(
          key,
          { ...options.commandRequest, expectedGeneration: key.generation },
          context,
        )
        results.push({
          name: 'command execution returns a complete successful result',
          passed:
            validCommandResult(command) &&
            command.exitCode === 0 &&
            !command.timedOut &&
            !command.cancelled,
        })
      } catch (error) {
        results.push(failure('command execution completes', error))
      }
    }
  }

  if (ready && manifest.capabilities.fileAccess) {
    if (!provider.writeFile || !provider.readFile || !provider.listFiles) {
      results.push({
        name: 'fileAccess capability has read, write, and list methods',
        passed: false,
      })
    } else {
      try {
        const contentBase64 = Buffer.from('conformance').toString('base64')
        const expectedSize = Buffer.byteLength('conformance')
        const written = await provider.writeFile(
          key,
          { expectedGeneration: key.generation, path: 'probe.txt', contentBase64 },
          context,
        )
        const read = await provider.readFile(key, 'probe.txt', context)
        const listed = await provider.listFiles(key, '.', context)
        results.push({
          name: 'file round-trip returns complete metadata, bytes, and listing',
          passed:
            validFileResult(written, 'probe.txt', expectedSize) &&
            written.contentBase64 === contentBase64 &&
            validFileResult(read, 'probe.txt', expectedSize) &&
            read.contentBase64 === contentBase64 &&
            listed.every(validFileEntry) &&
            listed.some(
              (entry) =>
                entry.path === 'probe.txt' && entry.kind === 'file' && entry.size === expectedSize,
            ),
        })
      } catch (error) {
        results.push(failure('file round-trip completes', error))
      }
    }
  }

  try {
    const terminated = await provider.terminate(key, context)
    results.push({
      name: 'terminate reaches terminated',
      passed: terminated.state === 'terminated',
    })
  } catch (error) {
    results.push(failure('terminate completes', error))
  }

  return results
}
