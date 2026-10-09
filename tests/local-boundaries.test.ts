import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdtemp, open, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalSandboxProvider } from '../src/index.js'

const providers: LocalSandboxProvider[] = []
const roots: string[] = []
const context = { requestId: 'local-boundary' }
const key = { sandboxId: 'synthetic-boundary', generation: 1 }
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const bounded = async <T>(operation: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('operation did not settle')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('Unix Local Provider boundaries', () => {
  it('rejects FIFO file writes and listings without hanging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sandbox-fifo-test-'))
    roots.push(root)
    const provider = new LocalSandboxProvider({ rootDirectory: root })
    providers.push(provider)
    await provider.provision({ ...key, spec: { clientRequestId: 'fifo-fixture' } }, context)
    const [directory] = await readdir(root)
    if (!directory) throw new Error('missing synthetic resource')
    const fifo = join(root, directory, 'probe.fifo')
    await promisify(execFile)('mkfifo', [fifo])
    const write = provider.writeFile(
      key,
      { expectedGeneration: 1, path: 'probe.fifo', contentBase64: 'cHJvYmU=' },
      context,
    )
    try {
      await expect(bounded(write, 250)).rejects.toMatchObject({ code: 'invalid_request' })
      await expect(provider.listFiles(key, '.', context)).rejects.toMatchObject({
        code: 'invalid_request',
      })
    } finally {
      // Release any old blocking FIFO writer so a failing regression leaves no open I/O.
      const reader = await open(fifo, constants.O_RDONLY | constants.O_NONBLOCK)
      await write.catch(() => undefined)
      await reader.close()
    }
  })

  it('cancels descendants holding output after their process-group leader exits', async () => {
    const provider = new LocalSandboxProvider()
    providers.push(provider)
    await provider.provision({ ...key, spec: { clientRequestId: 'descendant-fixture' } }, context)
    const controller = new AbortController()
    const script = [
      'const {spawn}=require("node:child_process")',
      'const child=spawn(process.execPath,["-e","setTimeout(()=>{},2000)"],{stdio:"inherit"})',
      'require("node:fs").writeFileSync("owned-pids.json",JSON.stringify({leader:process.pid,child:child.pid}))',
      'process.exit(0)',
    ].join(';')
    const execution = provider.execute(
      key,
      { expectedGeneration: 1, argv: [process.execPath, '-e', script], timeoutSeconds: 5 },
      { ...context, signal: controller.signal },
    )
    let ownedChild: number | undefined
    let completed = false
    try {
      const deadline = Date.now() + 1_500
      let leader: number | undefined
      while (Date.now() < deadline) {
        const content = await provider
          .readFile(key, 'owned-pids.json', context)
          .catch(() => undefined)
        if (content) {
          const pids = JSON.parse(Buffer.from(content.contentBase64, 'base64').toString('utf8'))
          if (
            !Number.isInteger(pids.leader) ||
            pids.leader < 2 ||
            !Number.isInteger(pids.child) ||
            pids.child < 2
          )
            throw new Error('invalid synthetic ownership')
          leader = pids.leader
          ownedChild = pids.child
          try {
            process.kill(pids.leader, 0)
          } catch {
            break
          }
        }
        await delay(10)
      }
      expect(leader).toBeDefined()
      expect(ownedChild).toBeDefined()
      expect(() => process.kill(leader as number, 0)).toThrow()
      await delay(20)
      controller.abort()
      await expect(bounded(execution, 500)).resolves.toMatchObject({
        cancelled: true,
        timedOut: false,
      })
      completed = true
    } finally {
      // Only this fixture's known, still-live child is eligible for cleanup.
      if (!completed && ownedChild) {
        try {
          process.kill(ownedChild, 'SIGKILL')
        } catch {
          /* Already exited. */
        }
      }
      await execution.catch(() => undefined)
    }
  })
})
