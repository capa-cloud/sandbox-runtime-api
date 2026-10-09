import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const scanner = resolve('scripts/scan-public.sh')
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sandbox-scan-fixture-'))
  roots.push(root)
  return root
}
const scan = (root: string) =>
  spawnSync('bash', [scanner, '.'], { cwd: root, encoding: 'utf8', timeout: 5_000 })

describe('public-content scanner', () => {
  it('detects credentials without relying on ripgrep being installed', async () => {
    const root = await fixture()
    const tools = join(root, 'tools')
    const target = join(root, 'target')
    await mkdir(tools)
    await mkdir(target)
    for (const [name, executable] of Object.entries({
      node: process.execPath,
      find: '/usr/bin/find',
      git: '/usr/bin/git',
    })) {
      await symlink(executable, join(tools, name))
    }
    await writeFile(join(target, 'probe.txt'), ['ghp', '_', 'x'.repeat(40)].join(''))
    const result = spawnSync('/bin/bash', [scanner, '.'], {
      cwd: target,
      env: { ...process.env, PATH: tools },
      encoding: 'utf8',
      timeout: 5_000,
    })
    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toContain('probe.txt')
    expect(result.stderr).not.toContain('command not found')
  })

  it('reports credential locations without printing matching values', async () => {
    const root = await fixture()
    const synthetic = `synthetic-${'x'.repeat(30)}`
    await writeFile(join(root, 'probe.txt'), JSON.stringify({ api_key: synthetic }))
    const result = scan(root)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('probe.txt')
    expect(result.stdout).not.toContain(synthetic)
  })

  it.each(['ghp', 'github_pat', 'xoxb', 'AKIA'])(
    'detects a synthetic %s-shaped credential',
    async (prefix) => {
      const root = await fixture()
      const synthetic =
        prefix === 'AKIA'
          ? prefix + 'X'.repeat(16)
          : prefix + (prefix === 'xoxb' ? '-' : '_') + 'x'.repeat(40)
      await writeFile(join(root, 'probe.txt'), synthetic)
      const result = scan(root)
      expect(result.status).toBe(1)
      expect(result.stdout).not.toContain(synthetic)
    },
  )

  it('keeps historical credential detection without leaking commit content', async () => {
    const root = await fixture()
    const synthetic = ['ghp', '_', 'x'.repeat(40)].join('')
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    await writeFile(join(root, 'probe.txt'), synthetic)
    execFileSync('git', ['add', 'probe.txt'], { cwd: root })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '--quiet',
        '-m',
        'synthetic history',
      ],
      { cwd: root },
    )
    await writeFile(join(root, 'probe.txt'), 'safe current content')
    const result = scan(root)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('history')
    expect(result.stdout).not.toContain(synthetic)
  })

  it('passes clean synthetic content and rejects dangerous files', async () => {
    const root = await fixture()
    await writeFile(join(root, 'probe.txt'), 'safe example')
    expect(scan(root).status).toBe(0)
    await writeFile(join(root, '.env'), 'synthetic fixture')
    expect(scan(root).status).toBe(1)
  })

  it('fails closed for an invalid root and unreadable repository history', async () => {
    const root = await fixture()
    const missing = spawnSync('bash', [scanner, 'missing-directory'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('refusing a clean result')
    await mkdir(join(root, '.git'))
    const brokenHistory = scan(root)
    expect(brokenHistory.status).toBe(2)
    expect(brokenHistory.stderr).toContain('refusing a clean result')
  })
})
