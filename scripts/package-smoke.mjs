import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { SandboxRuntimeClient } from 'sandbox-runtime-api'

const root = join(process.cwd(), 'cli-resources')
await mkdir(root)
const startupRoot = join(process.cwd(), 'cli-startup')
await mkdir(startupRoot)
const denied = spawnSync(
  process.execPath,
  ['node_modules/sandbox-runtime-api/dist/cli.js', 'serve', '--host', '0.0.0.0', '--port', '0'],
  {
    env: { ...process.env, TMPDIR: startupRoot },
    encoding: 'utf8',
    timeout: 5_000,
  },
)
assert.equal(denied.status, 1)
assert.deepEqual(await readdir(startupRoot), [])
const child = spawn(
  process.platform === 'win32'
    ? process.execPath
    : join(process.cwd(), 'node_modules/.bin/sandbox-runtime'),
  [
    ...(process.platform === 'win32' ? ['node_modules/sandbox-runtime-api/dist/cli.js'] : []),
    'serve',
    '--port',
    '0',
    '--root',
    root,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
const exited = once(child, 'exit')
// Attach a handler immediately, including when startup fails before readiness.
void exited.catch(() => undefined)
const lines = createInterface({ input: child.stdout })
const bounded = async (operation, timeoutMs) => {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('package smoke timed out')), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

let failure
try {
  const [baseUrl] = await bounded(
    Promise.race([
      once(lines, 'line'),
      exited.then(() => {
        throw new Error('packaged CLI exited before readiness')
      }),
    ]),
    5_000,
  )
  const client = new SandboxRuntimeClient(baseUrl)
  const signal = AbortSignal.timeout(8_000)
  assert.equal((await fetch(`${baseUrl}/healthz`, { signal })).status, 200)
  assert.equal((await client.getRuntimeInfo(signal)).provider.runtimeClass, 'local-process-unsafe')
  const resource = await client.create({ clientRequestId: 'package-create' }, signal)
  const bytes = Buffer.from('synthetic-package-probe').toString('base64')
  await client.writeFile(resource.id, resource.generation, 'probe.txt', bytes, signal)
  assert.equal(
    (await client.readFile(resource.id, resource.generation, 'probe.txt', signal)).contentBase64,
    bytes,
  )
  assert.equal(
    (await client.listFiles(resource.id, resource.generation, '.', signal)).some(
      (entry) => entry.path === 'probe.txt',
    ),
    true,
  )
  assert.equal(
    (
      await client.execute(
        resource.id,
        {
          expectedGeneration: resource.generation,
          argv: [process.execPath, '-e', 'process.stdout.write("package-probe")'],
        },
        signal,
      )
    ).stdout,
    'package-probe',
  )
  const stream = client.streamEvents({ sandboxId: resource.id, signal })
  try {
    assert.equal((await bounded(stream.next(), 3_000)).value.sandboxId, resource.id)
  } finally {
    await stream.return()
  }
  assert.equal(
    (await client.terminate(resource.id, resource.generation, signal)).state,
    'terminated',
  )
  const recreated = await client.recreate(
    resource.id,
    resource.generation,
    {
      clientRequestId: 'package-recreate',
    },
    signal,
  )
  assert.equal(recreated.generation, resource.generation + 1)
  await assert.rejects(client.terminate(resource.id, resource.generation, signal), {
    code: 'generation_conflict',
  })
  // Leave the recreated resource active: graceful CLI shutdown must clean it.
} catch (error) {
  failure = error
} finally {
  lines.close()
  child.kill('SIGTERM')
  try {
    assert.equal((await bounded(exited, 5_000))[0], 0)
  } catch (error) {
    child.kill('SIGKILL')
    await exited.catch(() => undefined)
    failure ??= error
  }
}
if (failure) throw failure
assert.deepEqual(await readdir(root), [])
console.log(
  'installed package SDK, CLI, lifecycle, files, command, SSE, fencing, and shutdown passed',
)
