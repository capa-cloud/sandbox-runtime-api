import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = resolve('scripts/check-identity.mjs')
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sandbox-identity-test-'))
  roots.push(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  return root
}
const commit = (root: string, author: string, committer = author) => {
  execFileSync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'synthetic identity fixture',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: author,
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: committer,
      },
    },
  )
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}
const scan = (root: string, args: string[] = []) =>
  spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', timeout: 5_000 })
const publicEmail = '12345+fixture@users.noreply.github.com'

describe('public commit identity gate', () => {
  it('accepts public noreply authors and GitHub merge committers', async () => {
    const root = await fixture()
    commit(root, publicEmail, 'noreply@github.com')
    expect(scan(root).status).toBe(0)
  }, 20_000)
  it.each(['author', 'committer'])(
    'rejects a non-noreply %s without printing values',
    async (field) => {
      const root = await fixture()
      const synthetic = 'private-fixture@example.test'
      commit(
        root,
        field === 'author' ? synthetic : publicEmail,
        field === 'committer' ? synthetic : publicEmail,
      )
      const result = scan(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`${field} email`)
      expect(result.stderr).not.toContain(synthetic)
    },
    20_000,
  )
  it('checks every commit in an explicit range, not just its head', async () => {
    const root = await fixture()
    const base = commit(root, publicEmail)
    commit(root, 'private-fixture@example.test')
    commit(root, publicEmail)
    expect(scan(root, ['--since', base]).status).toBe(1)
    expect(scan(root).status).toBe(1)
  }, 20_000)
  it('keeps a declared legacy baseline explicit without claiming history is scrubbed', async () => {
    const root = await fixture()
    const base = commit(root, 'legacy-fixture@example.test')
    commit(root, publicEmail)
    const result = scan(root, ['--since', base])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('1 commits')
    expect(scan(root, ['--', '--since', base]).status).toBe(0)
    expect(scan(root).status).toBe(1)
  }, 20_000)
  it('fails closed for a missing repository or invalid baseline', async () => {
    const root = await fixture()
    expect(scan(root).status).toBe(2)
    commit(root, publicEmail)
    expect(scan(root, ['--since', 'missing-ref']).status).toBe(2)
    expect(scan(root, ['--unknown']).status).toBe(2)
  }, 20_000)
})
