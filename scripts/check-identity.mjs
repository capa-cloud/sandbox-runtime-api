import { execFileSync } from 'node:child_process'

const suppliedArguments = process.argv.slice(2)
const arguments_ = suppliedArguments[0] === '--' ? suppliedArguments.slice(1) : suppliedArguments
const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const isPublicEmail = (value) =>
  /^[A-Za-z0-9_.+\-[\]]+@users\.noreply\.github\.com$|^noreply@github\.com$/.test(value)
try {
  if (arguments_.length !== 0 && (arguments_.length !== 2 || arguments_[0] !== '--since'))
    throw new Error('invalid arguments')
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}'])
  let range = head
  if (arguments_.length) {
    const base = git(['rev-parse', '--verify', '--end-of-options', `${arguments_[1]}^{commit}`])
    git(['merge-base', '--is-ancestor', base, head])
    range = `${base}..${head}`
  }
  const records = git(['log', '--format=%H%x00%ae%x00%ce', range]).split('\n').filter(Boolean)
  const hits = []
  for (const record of records) {
    const [commit, author, committer] = record.split('\0')
    if (!isPublicEmail(author)) hits.push({ commit, field: 'author email' })
    if (!isPublicEmail(committer)) hits.push({ commit, field: 'committer email' })
  }
  if (hits.length) {
    process.stderr.write(
      `non-public commit identity format detected; values withheld\n${hits.map(({ commit, field }) => `${commit}: ${field}`).join('\n')}\n`,
    )
    process.exitCode = 1
  } else process.stdout.write(`commit identity check passed: ${records.length} commits\n`)
} catch {
  process.stderr.write('commit identity check could not complete; refusing a clean result\n')
  process.exitCode = 2
}
