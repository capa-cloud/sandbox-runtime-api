import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const credentials =
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|authorization:\s*bearer\s+[A-Za-z0-9._-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|api[_-]?key[^a-z0-9]{0,4}[:=]\s*["'][^"']{12,}["']/i
const locations =
  /\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|https?:\/\/[^/\s]+\.(?:internal|local)(?:\/|\s|$)|(?:^|[^0-9])(?:10\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3})(?:[^0-9]|$)/i
const imageMetadata =
  /trc_[a-z0-9]{16,}|atomic_[a-z0-9-]{16,}|\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+/i
const ignored = new Set(['.git', 'node_modules', 'coverage'])
const excluded = new Set(['pnpm-lock.yaml', 'scripts/scan-public.sh', 'scripts/scan-public.mjs'])
const root = resolve(process.argv[2] ?? '.')
let failed = false
const report = (label, paths) => {
  if (!paths.length) return
  failed = true
  process.stdout.write(`${label}:\n${paths.join('\n')}\n`)
}
const walk = async (directory) => {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await walk(path)))
    } else if (entry.isSymbolicLink()) report('unsupported symbolic file', [relative(root, path)])
    else if (entry.isFile()) result.push(path)
  }
  return result
}
try {
  if (!(await stat(root)).isDirectory()) throw new Error('invalid scan root')
  const credentialFiles = []
  const locationFiles = []
  const imageFiles = []
  const dangerous = []
  for (const path of await walk(root)) {
    const name = relative(root, path).split('\\').join('/')
    const basename = name.split('/').at(-1)
    if (
      !/\.(?:example|sample)$/.test(basename) &&
      /^(?:\.env(?:\..*)?|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|\.DS_Store)$|\.(?:pem|key|p12|keystore)$/i.test(
        basename,
      )
    )
      dangerous.push(name)
    if (excluded.has(name)) continue
    const bytes = await readFile(path)
    if (/\.(?:png|jpe?g|webp)$/i.test(name)) {
      if (imageMetadata.test(bytes.toString('latin1'))) imageFiles.push(name)
      continue
    }
    const content = bytes.toString('utf8')
    if (credentials.test(content)) credentialFiles.push(name)
    if (locations.test(content)) locationFiles.push(name)
  }
  report('dangerous files found', dangerous)
  report('credential-shaped content', credentialFiles)
  report('local absolute path or private-network literal', locationFiles)
  report('sensitive-shaped image metadata', imageFiles)
  let directory = root
  let repository = false
  for (;;) {
    const entries = await readdir(directory)
    if (entries.includes('.git')) {
      repository = true
      break
    }
    const parent = resolve(directory, '..')
    if (parent === directory) break
    directory = parent
  }
  if (repository) {
    const history = execFileSync(
      'git',
      [
        '-C',
        root,
        'log',
        '--all',
        '-p',
        '--',
        '.',
        ':!pnpm-lock.yaml',
        ':!scripts/scan-public.sh',
        ':!scripts/scan-public.mjs',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      },
    )
    const matches = history
      .split('\n')
      .filter(
        (line) => credentials.test(line) || locations.test(line) || imageMetadata.test(line),
      ).length
    if (matches)
      report('sensitive-shaped git history content detected; values withheld', [
        `${matches} matching lines`,
      ])
  }
  process.exitCode = failed ? 1 : 0
} catch {
  process.stderr.write('public-content scan could not complete; refusing a clean result\n')
  process.exitCode = 2
}
