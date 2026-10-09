#!/usr/bin/env node
import { InMemorySandboxRuntime } from './runtime.js'
import { LocalSandboxProvider } from './providers/local.js'
import { startSandboxRuntimeServer } from './server.js'

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const main = async (): Promise<void> => {
  const command = process.argv[2]
  if (command !== 'serve') {
    process.stderr.write(
      'Usage: sandbox-runtime serve [--host 127.0.0.1] [--port 4311] [--root DIRECTORY]\n',
    )
    process.exitCode = 64
    return
  }
  const host = argument('--host') ?? '127.0.0.1'
  const portValue = argument('--port') ?? '4311'
  const port = Number(portValue)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port ${portValue}`)
  }
  const rootDirectory = argument('--root')
  const provider = new LocalSandboxProvider(rootDirectory ? { rootDirectory } : {})
  const runtime = new InMemorySandboxRuntime(provider)
  const handle = await startSandboxRuntimeServer(runtime, { host, port }).catch(
    async (error: unknown) => {
      await provider.dispose().catch(() => undefined)
      throw error
    },
  )
  process.stdout.write(`${handle.baseUrl}\n`)

  const shutdown = async () => {
    await handle.close()
    await provider.dispose()
  }
  process.once('SIGINT', () => void shutdown().then(() => process.exit(0)))
  process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)))
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'runtime failed'}\n`)
  process.exitCode = 1
})
