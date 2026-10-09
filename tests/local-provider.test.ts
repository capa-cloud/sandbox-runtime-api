import { access, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  InMemorySandboxRuntime,
  LocalSandboxProvider,
  runProviderConformance,
} from '../src/index.js'

const providers: LocalSandboxProvider[] = []
const roots: string[] = []
const context = { requestId: 'local-test' }

const makeProvider = (): LocalSandboxProvider => {
  const result = new LocalSandboxProvider({ defaultTimeoutSeconds: 1 })
  providers.push(result)
  return result
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((entry) => entry.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LocalSandboxProvider', () => {
  it('executes argv without a shell and uses sandbox-local cwd and env', async () => {
    const runtime = new InMemorySandboxRuntime(makeProvider(), { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    const result = await runtime.execute(
      'sandbox-1',
      {
        expectedGeneration: 1,
        argv: [process.execPath, '-e', 'process.stdout.write(process.cwd()+"|"+process.env.PROBE)'],
        env: { PROBE: 'ok' },
      },
      context,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout.endsWith('|ok')).toBe(true)
    expect(result.timedOut).toBe(false)
  })

  it('captures stderr, bounds output, and terminates timed-out commands', async () => {
    const runtime = new InMemorySandboxRuntime(makeProvider(), { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    const bounded = await runtime.execute(
      'sandbox-1',
      {
        expectedGeneration: 1,
        argv: [
          process.execPath,
          '-e',
          'process.stdout.write("abcdef");process.stderr.write("bad")',
        ],
        maxOutputBytes: 3,
      },
      context,
    )
    expect(bounded).toMatchObject({ stdout: 'abc', stderr: 'bad', truncated: true })

    const timedOut = await runtime.execute(
      'sandbox-1',
      {
        expectedGeneration: 1,
        argv: [process.execPath, '-e', 'setTimeout(()=>{}, 10000)'],
        timeoutSeconds: 0.02,
      },
      context,
    )
    expect(timedOut.timedOut).toBe(true)
  })

  it('does not spawn a command when the context is already cancelled', async () => {
    const runtime = new InMemorySandboxRuntime(makeProvider(), { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    const controller = new AbortController()
    controller.abort()
    await expect(
      runtime.execute(
        'sandbox-1',
        {
          expectedGeneration: 1,
          argv: [process.execPath, '-e', 'process.stdout.write("should-not-run")'],
        },
        { requestId: 'cancelled', signal: controller.signal },
      ),
    ).resolves.toMatchObject({ exitCode: null, cancelled: true, timedOut: false, stdout: '' })
  })

  it('allows lifecycle termination to cancel a running command and its descendants', async () => {
    const runtime = new InMemorySandboxRuntime(makeProvider(), { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    const markerRoot = await mkdtemp(join(tmpdir(), 'sandbox-descendant-test-'))
    roots.push(markerRoot)
    const marker = join(markerRoot, 'probe.txt')
    const script = [
      'const {spawn}=require("node:child_process")',
      `spawn(process.execPath,["-e",${JSON.stringify(`setTimeout(()=>require("node:fs").writeFileSync(${JSON.stringify(marker)},"bad"),300)`)}],{stdio:"ignore"})`,
      'setTimeout(()=>{},10000)',
    ].join(';')
    const execution = runtime.execute(
      'sandbox-1',
      { expectedGeneration: 1, argv: [process.execPath, '-e', script], timeoutSeconds: 5 },
      context,
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    const terminated = await runtime.terminate('sandbox-1', 1, context)
    const result = await execution
    expect(terminated.state).toBe('terminated')
    expect(result).toMatchObject({ timedOut: false, cancelled: true, exitCode: null })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(
      await access(marker)
        .then(() => true)
        .catch(() => false),
    ).toBe(false)
  })

  it('round-trips files and rejects lexical path traversal', async () => {
    const runtime = new InMemorySandboxRuntime(makeProvider(), { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    const contentBase64 = Buffer.from('safe').toString('base64')
    await runtime.writeFile(
      'sandbox-1',
      { expectedGeneration: 1, path: 'safe.txt', contentBase64 },
      context,
    )
    expect(await runtime.readFile('sandbox-1', 1, 'safe.txt', context)).toMatchObject({
      contentBase64,
      size: 4,
    })
    expect(await runtime.listFiles('sandbox-1', 1, '.', context)).toContainEqual({
      path: 'safe.txt',
      kind: 'file',
      size: 4,
    })
    await expect(runtime.readFile('sandbox-1', 1, '../outside.txt', context)).rejects.toMatchObject(
      {
        code: 'invalid_request',
      },
    )
    await expect(
      runtime.writeFile(
        'sandbox-1',
        { expectedGeneration: 1, path: '../outside.txt', contentBase64 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('rejects symlink escape and invalid base64', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sandbox-file-test-'))
    roots.push(root)
    const local = new LocalSandboxProvider({ rootDirectory: root })
    providers.push(local)
    const runtime = new InMemorySandboxRuntime(local, { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    const [resourceDirectory] = await readdir(root)
    if (!resourceDirectory) throw new Error('local provider resource directory was not created')
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(root, resourceDirectory, 'escape'))

    await expect(runtime.listFiles('sandbox-1', 1, '.', context)).rejects.toMatchObject({
      code: 'invalid_request',
    })
    await expect(
      runtime.writeFile(
        'sandbox-1',
        { expectedGeneration: 1, path: 'bad.txt', contentBase64: 'not-base64' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('removes the resource and recreates a clean generation', async () => {
    const runtime = new InMemorySandboxRuntime(makeProvider(), { idFactory: () => 'sandbox-1' })
    await runtime.create({ clientRequestId: 'create-1' }, context)
    await runtime.writeFile(
      'sandbox-1',
      {
        expectedGeneration: 1,
        path: 'old.txt',
        contentBase64: Buffer.from('old').toString('base64'),
      },
      context,
    )
    await runtime.terminate('sandbox-1', 1, context)
    await runtime.recreate('sandbox-1', 1, { clientRequestId: 'create-2' }, context)
    await expect(runtime.readFile('sandbox-1', 2, 'old.txt', context)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('rejects unsupported image and resource requests before creating a local resource', async () => {
    const runtime = new InMemorySandboxRuntime(makeProvider())
    await expect(
      runtime.create({ clientRequestId: 'image', image: 'public.example/image:latest' }, context),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    await expect(
      runtime.create({ clientRequestId: 'resource', resources: { memoryMiB: 128 } }, context),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(runtime.list()).toHaveLength(0)
  })

  it('passes portable provider conformance', async () => {
    const results = await runProviderConformance(makeProvider(), {
      commandRequest: { argv: [process.execPath, '-e', 'process.exit(0)'] },
    })
    expect(results.filter((result) => !result.passed)).toEqual([])
  })
})
