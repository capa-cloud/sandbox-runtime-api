import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'sandbox-runtime-pack-'))

try {
  const archive = join(temporary, 'package.tgz')
  execFileSync('pnpm', ['pack', '--out', archive], { cwd: root, stdio: 'pipe' })
  const files = new Set(
    execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'),
  )
  const read = (path) => execFileSync('tar', ['-xOzf', archive, path], { encoding: 'utf8' })
  const packaged = JSON.parse(read('package/package.json'))
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const missing = []
  const required = [
    packaged.exports['.'].import,
    packaged.exports['.'].types,
    ...Object.values(packaged.bin),
    'README.md',
    'README.zh-CN.md',
    'DOCS-INDEX.md',
    'LICENSE',
    'spec/openapi.yaml',
  ]
  for (const path of required) {
    if (!files.has(posix.join('package', path))) missing.push(path)
  }
  if (packaged.name !== source.name || packaged.version !== source.version) {
    missing.push('package identity differs from source')
  }
  for (const path of files) {
    if (!path.endsWith('.md')) continue
    for (const match of read(path).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]
      if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      const resolved = posix.join(posix.dirname(path), decodeURIComponent(target.split('#')[0]))
      if (!files.has(resolved)) missing.push(`${path} -> ${target}`)
    }
  }
  if (missing.length) throw new Error(`package validation failed:\n${missing.join('\n')}`)
  const consumer = join(temporary, 'consumer')
  await mkdir(consumer)
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive],
    {
      cwd: consumer,
      stdio: 'pipe',
      timeout: 60_000,
    },
  )
  const example = join(consumer, 'embedded-runtime.mts')
  await writeFile(example, read('package/examples/embedded-runtime.mts'))
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      '--strict',
      '--outDir',
      consumer,
      example,
    ],
    { cwd: consumer, stdio: 'pipe', timeout: 30_000 },
  )
  execFileSync(process.execPath, [join(consumer, 'embedded-runtime.mjs')], {
    cwd: consumer,
    stdio: 'pipe',
    timeout: 10_000,
  })
  const smoke = await readFile(join(root, 'scripts/package-smoke.mjs'), 'utf8')
  execFileSync(process.execPath, ['--input-type=module', '--eval', smoke], {
    cwd: consumer,
    stdio: 'pipe',
    timeout: 20_000,
  })
  process.stdout.write(
    `package validation passed: ${files.size} entries; local links, installed types/example, SDK, CLI, SSE, and shutdown\n`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
