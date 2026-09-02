import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ignored = new Set(['node_modules', '.git', 'dist', 'coverage'])

const walk = async (directory) => {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await walk(path)))
    else result.push(path)
  }
  return result
}

const files = await walk(root)
const markdown = files.filter((path) => path.endsWith('.md'))
const broken = []
const ids = new Map()

for (const path of markdown) {
  const content = await readFile(path, 'utf8')
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (frontmatter) {
    const metadata = parse(frontmatter[1])
    if (!metadata?.id || !metadata?.authority || !metadata?.status) {
      broken.push(`${relative(root, path)}: incomplete frontmatter`)
    } else if (ids.has(metadata.id)) {
      broken.push(`${relative(root, path)}: duplicate id ${metadata.id}`)
    } else ids.set(metadata.id, path)
  }

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    const withoutAnchor = decodeURIComponent(target.split('#')[0])
    const resolved = normalize(resolve(dirname(path), withoutAnchor))
    if (!files.includes(resolved)) broken.push(`${relative(root, path)} -> ${target}`)
  }
}

const openapiPath = join(root, 'spec/openapi.yaml')
const openapi = parse(await readFile(openapiPath, 'utf8'))
if (openapi?.openapi !== '3.1.0' || !openapi?.paths || !openapi?.components?.schemas) {
  broken.push('spec/openapi.yaml: incomplete OpenAPI 3.1 document')
}

if (broken.length > 0) {
  process.stderr.write(`documentation validation failed:\n${broken.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(
  `documentation validation passed: ${markdown.length} markdown files, ${ids.size} managed ids\n`,
)
