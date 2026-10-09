import { randomUUID } from 'node:crypto'
import type { ProviderContext, SandboxProvider } from './provider.js'
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
  operationTimeoutMs?: number
  cleanupTimeoutMs?: number
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

const callBefore = async <T>(
  operation: (context: ProviderContext) => Promise<T>,
  requestId: string,
  deadline: number,
  timeoutMessage: string,
): Promise<T> => {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) throw new Error(timeoutMessage)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({ requestId, signal: controller.signal })),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage))
          controller.abort()
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
  const operationTimeoutMs = options.operationTimeoutMs ?? 5_000
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5_000
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 5_000
  const pollIntervalMs = options.pollIntervalMs ?? 25
  for (const [name, value] of Object.entries({
    operationTimeoutMs,
    cleanupTimeoutMs,
    readinessTimeoutMs,
    pollIntervalMs,
  })) {
    if (!Number.isInteger(value) || value <= 0 || value > 2 ** 31 - 1) {
      return [
        failure(
          'conformance options are valid',
          new Error(`${name} must be an integer between 1 and 2147483647`),
        ),
      ]
    }
  }
  const call = <T>(
    name: string,
    operation: (ctx: ProviderContext) => Promise<T>,
    timeoutMs = operationTimeoutMs,
  ): Promise<T> =>
    callBefore(operation, context.requestId, Date.now() + timeoutMs, `${name} timed out`)

  let manifest: ProviderManifest
  try {
    manifest = await call('describe', (ctx) => provider.describe(ctx))
  } catch (error) {
    return [failure('provider manifest is readable', error)]
  }
  results.push({ name: 'provider manifest is complete', passed: validManifest(manifest) })
  if (!validManifest(manifest)) return results

  let cleanupName = 'terminate reaches terminated'
  try {
    try {
      const provisioned = await call('provision', (ctx) =>
        provider.provision(
          { ...key, spec: { clientRequestId: `conformance-create-${runId}` } },
          ctx,
        ),
      )
      const valid = Boolean(
        provisioned && ['requested', 'starting', 'ready'].includes(provisioned.state),
      )
      results.push({
        name: 'provision returns an observable non-terminal state',
        passed: valid,
        ...(!valid ? { detail: `observed ${provisioned?.state ?? 'missing state'}` } : {}),
      })
      if (!valid) return results
    } catch (error) {
      results.push(failure('provision returns an observation', error))
      cleanupName = 'ambiguous provision failure is cleaned up'
      return results
    }

    let ready = false
    try {
      const deadline = Date.now() + readinessTimeoutMs
      const observe = () =>
        callBefore(
          (ctx) => provider.observe(key, ctx),
          context.requestId,
          deadline,
          'readiness observation timed out',
        )
      let observed = await observe()
      while (!['ready', 'failed', 'terminated'].includes(observed.state) && Date.now() < deadline) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))),
        )
        observed = await observe()
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
          ready = false
          const pause = provider.pause
          const resume = provider.resume
          const paused = await call('pause', (ctx) => pause.call(provider, key, ctx))
          results.push({ name: 'pause reaches paused', passed: paused.state === 'paused' })
          if (paused.state === 'paused') {
            const resumed = await call('resume', (ctx) => resume.call(provider, key, ctx))
            ready = resumed.state === 'ready'
            results.push({ name: 'resume leaves paused', passed: ready })
          }
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
          const execute = provider.execute
          const commandRequest = options.commandRequest
          const command = await call('execute', (ctx) =>
            execute.call(
              provider,
              key,
              { ...commandRequest, expectedGeneration: key.generation },
              ctx,
            ),
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
          const writeFile = provider.writeFile
          const readFile = provider.readFile
          const listFiles = provider.listFiles
          const written = await call('writeFile', (ctx) =>
            writeFile.call(
              provider,
              key,
              { expectedGeneration: key.generation, path: 'probe.txt', contentBase64 },
              ctx,
            ),
          )
          const read = await call('readFile', (ctx) =>
            readFile.call(provider, key, 'probe.txt', ctx),
          )
          const listed = await call('listFiles', (ctx) => listFiles.call(provider, key, '.', ctx))
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
                  entry.path === 'probe.txt' &&
                  entry.kind === 'file' &&
                  entry.size === expectedSize,
              ),
          })
        } catch (error) {
          results.push(failure('file round-trip completes', error))
        }
      }
    }

    return results
  } finally {
    try {
      const terminated = await call(
        'terminate',
        (ctx) => provider.terminate(key, ctx),
        cleanupTimeoutMs,
      )
      results.push({ name: cleanupName, passed: terminated?.state === 'terminated' })
    } catch (error) {
      results.push(failure(cleanupName, error))
    }
  }
}
