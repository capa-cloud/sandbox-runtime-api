import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  ProviderContext,
  ProviderObservation,
  ProviderProvisionRequest,
  ProviderSandboxKey,
  SandboxProvider,
} from '../provider.js'
import {
  type CommandRequest,
  type CommandResult,
  type FileEntry,
  type FileReadResult,
  type FileWriteRequest,
  type ProviderManifest,
  RuntimeError,
} from '../protocol.js'

type LocalResource = {
  directory: string
  processes: Map<ChildProcess, () => void>
}

export type LocalSandboxProviderOptions = Readonly<{
  rootDirectory?: string
  defaultTimeoutSeconds?: number
  defaultMaxOutputBytes?: number
  maxFileBytes?: number
}>

const isWithin = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

const decodeBase64 = (value: string): Buffer => {
  const normalized = value.replace(/\s/g, '')
  if (
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new RuntimeError('invalid_request', 'contentBase64 is not valid base64')
  }
  return Buffer.from(normalized, 'base64')
}

export class LocalSandboxProvider implements SandboxProvider {
  readonly #resources = new Map<string, LocalResource>()
  readonly #root: Promise<string>
  readonly #ownsRoot: boolean
  readonly #defaultTimeoutSeconds: number
  readonly #defaultMaxOutputBytes: number
  readonly #maxFileBytes: number

  constructor(options: LocalSandboxProviderOptions = {}) {
    this.#ownsRoot = !options.rootDirectory
    const configuredRoot = options.rootDirectory
    this.#root = configuredRoot
      ? mkdir(resolve(configuredRoot), { recursive: true }).then(() => realpath(configuredRoot))
      : mkdtemp(join(tmpdir(), 'sandbox-runtime-api-'))
    this.#defaultTimeoutSeconds = options.defaultTimeoutSeconds ?? 30
    this.#defaultMaxOutputBytes = options.defaultMaxOutputBytes ?? 1024 * 1024
    this.#maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024
  }

  async describe(_context: ProviderContext): Promise<ProviderManifest> {
    return {
      name: 'local',
      version: '0.1.1',
      runtimeClass: 'local-process-unsafe',
      capabilities: {
        commandExecution: true,
        fileAccess: true,
        interactiveTerminal: false,
        portForwarding: false,
        pauseResume: false,
        filesystemSnapshot: false,
        memorySnapshot: false,
        persistentVolume: false,
        networkPolicy: false,
        imageReference: false,
        templateReference: false,
        resourceLimits: false,
      },
    }
  }

  async provision(
    request: ProviderProvisionRequest,
    _context: ProviderContext,
  ): Promise<ProviderObservation> {
    if (request.spec.image || request.spec.template) {
      throw new RuntimeError(
        'invalid_request',
        'the local provider does not implement image or template isolation',
      )
    }
    const root = await this.#root
    const resourceKey = this.#key(request)
    const directory = join(root, createHash('sha256').update(resourceKey).digest('hex'))
    await mkdir(join(directory, 'tmp'), { recursive: true })
    this.#resources.set(resourceKey, { directory: await realpath(directory), processes: new Map() })
    return { state: 'ready', extensions: { 'local.resourceKey': resourceKey } }
  }

  async observe(key: ProviderSandboxKey, _context: ProviderContext): Promise<ProviderObservation> {
    return { state: this.#resources.has(this.#key(key)) ? 'ready' : 'terminated' }
  }

  async terminate(
    key: ProviderSandboxKey,
    _context: ProviderContext,
  ): Promise<ProviderObservation> {
    const resource = this.#resources.get(this.#key(key))
    if (!resource) return { state: 'terminated' }
    for (const cancel of resource.processes.values()) cancel()
    await rm(resource.directory, { recursive: true, force: true })
    this.#resources.delete(this.#key(key))
    return { state: 'terminated' }
  }

  async execute(
    key: ProviderSandboxKey,
    request: CommandRequest,
    context: ProviderContext,
  ): Promise<CommandResult> {
    const startedAt = new Date().toISOString()
    if (context.signal?.aborted) return this.#cancelledResult(startedAt)
    if (
      request.argv.length === 0 ||
      request.argv.some((argument) => typeof argument !== 'string')
    ) {
      throw new RuntimeError('invalid_request', 'argv must contain at least one string')
    }
    if (request.argv.some((argument) => argument.includes('\0'))) {
      throw new RuntimeError('invalid_request', 'argv must not contain null bytes')
    }
    const resource = this.#resource(key)
    const cwd = await this.#existingPath(resource, request.cwd ?? '.')
    if (!(await stat(cwd)).isDirectory()) {
      throw new RuntimeError('invalid_request', 'cwd must be a directory')
    }
    if (context.signal?.aborted) return this.#cancelledResult(startedAt)
    const timeoutSeconds = request.timeoutSeconds ?? this.#defaultTimeoutSeconds
    const maxOutputBytes = request.maxOutputBytes ?? this.#defaultMaxOutputBytes
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 3600) {
      throw new RuntimeError('invalid_request', 'timeoutSeconds must be in (0, 3600]')
    }
    if (
      !Number.isInteger(maxOutputBytes) ||
      maxOutputBytes < 1 ||
      maxOutputBytes > 10 * 1024 * 1024
    ) {
      throw new RuntimeError('invalid_request', 'maxOutputBytes must be in [1, 10485760]')
    }
    for (const [name, value] of Object.entries(request.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes('\0')) {
        throw new RuntimeError('invalid_request', `invalid environment entry ${name}`)
      }
    }

    const [command, ...arguments_] = request.argv
    if (!command) throw new RuntimeError('invalid_request', 'argv is required')
    const child = spawn(command, arguments_, {
      cwd,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: resource.directory,
        TMPDIR: join(resource.directory, 'tmp'),
        LANG: 'C.UTF-8',
        ...request.env,
      },
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    let timedOut = false
    let cancelled = false
    const capture = (target: Buffer[], chunk: Buffer, currentBytes: number): number => {
      const available = Math.max(0, maxOutputBytes - currentBytes)
      if (chunk.byteLength > available) truncated = true
      if (available > 0) target.push(chunk.subarray(0, available))
      return currentBytes + Math.min(available, chunk.byteLength)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes = capture(stdout, chunk, stdoutBytes)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes = capture(stderr, chunk, stderrBytes)
    })

    const timeout = () => {
      timedOut = true
      this.#killProcess(child)
    }
    const abort = () => {
      cancelled = true
      this.#killProcess(child)
    }
    resource.processes.set(child, abort)
    const timer = setTimeout(timeout, timeoutSeconds * 1000)
    context.signal?.addEventListener('abort', abort, { once: true })
    if (context.signal?.aborted) abort()

    try {
      const exitCode = await new Promise<number | null>((resolveExit, reject) => {
        child.once('error', reject)
        child.once('close', resolveExit)
      })
      return {
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        cancelled,
        truncated,
        startedAt,
        finishedAt: new Date().toISOString(),
      }
    } finally {
      clearTimeout(timer)
      context.signal?.removeEventListener('abort', abort)
      resource.processes.delete(child)
    }
  }

  async readFile(
    key: ProviderSandboxKey,
    path: string,
    _context: ProviderContext,
  ): Promise<FileReadResult> {
    const resource = this.#resource(key)
    const target = await this.#existingPath(resource, path)
    const metadata = await lstat(target)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RuntimeError('invalid_request', 'path must reference a regular file')
    }
    if (metadata.size > this.#maxFileBytes) {
      throw new RuntimeError('invalid_request', 'file exceeds the configured read limit')
    }
    const content = await readFile(target)
    return { path, contentBase64: content.toString('base64'), size: content.byteLength }
  }

  async writeFile(
    key: ProviderSandboxKey,
    request: FileWriteRequest,
    _context: ProviderContext,
  ): Promise<FileReadResult> {
    const resource = this.#resource(key)
    const target = await this.#writablePath(resource, request.path)
    const content = decodeBase64(request.contentBase64)
    if (content.byteLength > this.#maxFileBytes) {
      throw new RuntimeError('invalid_request', 'file exceeds the configured write limit')
    }
    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    ).catch(() => {
      throw new RuntimeError('invalid_request', 'write target must be a regular non-symbolic file')
    })
    try {
      if (!(await handle.stat()).isFile()) {
        throw new RuntimeError('invalid_request', 'write target must be a regular file')
      }
      await handle.truncate(0)
      await handle.writeFile(content)
    } finally {
      await handle.close()
    }
    return {
      path: request.path,
      contentBase64: content.toString('base64'),
      size: content.byteLength,
    }
  }

  async listFiles(
    key: ProviderSandboxKey,
    path: string,
    _context: ProviderContext,
  ): Promise<readonly FileEntry[]> {
    const resource = this.#resource(key)
    const directory = await this.#existingPath(resource, path)
    if (!(await stat(directory)).isDirectory()) {
      throw new RuntimeError('invalid_request', 'path must reference a directory')
    }
    const entries = await readdir(directory, { withFileTypes: true })
    const result: FileEntry[] = []
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new RuntimeError('invalid_request', 'symbolic links are not portable file entries')
      }
      const entryPath = join(directory, entry.name)
      if (!entry.isFile() && !entry.isDirectory()) {
        throw new RuntimeError('invalid_request', 'special files are not portable file entries')
      }
      const metadata = await stat(entryPath)
      result.push({
        path: path === '.' || path === '' ? entry.name : `${path.replace(/\/$/, '')}/${entry.name}`,
        kind: entry.isDirectory() ? 'directory' : 'file',
        size: metadata.size,
      })
    }
    return result.sort((left, right) => left.path.localeCompare(right.path))
  }

  async dispose(): Promise<void> {
    for (const [key, resource] of this.#resources) {
      for (const cancel of resource.processes.values()) cancel()
      await rm(resource.directory, { recursive: true, force: true })
      this.#resources.delete(key)
    }
    if (this.#ownsRoot) await rm(await this.#root, { recursive: true, force: true })
  }

  #key(key: ProviderSandboxKey): string {
    return `${key.sandboxId}:${key.generation}`
  }

  #cancelledResult(startedAt: string): CommandResult {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: true,
      truncated: false,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
  }

  #killProcess(child: ChildProcess): void {
    if (!child.pid) return
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL')
        return
      } catch {
        // Fall back to the direct child when the process group has already exited.
      }
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }

  #resource(key: ProviderSandboxKey): LocalResource {
    const resource = this.#resources.get(this.#key(key))
    if (!resource) throw new RuntimeError('not_found', 'local sandbox resource does not exist')
    return resource
  }

  #validateRelativePath(path: string): void {
    if (!path || isAbsolute(path) || path.includes('\0')) {
      throw new RuntimeError('invalid_request', 'path must be a non-empty relative path')
    }
  }

  async #existingPath(resource: LocalResource, path: string): Promise<string> {
    this.#validateRelativePath(path)
    const candidate = resolve(resource.directory, path)
    if (!isWithin(resource.directory, candidate)) {
      throw new RuntimeError('invalid_request', 'path escapes the sandbox directory')
    }
    const actual = await realpath(candidate).catch(() => {
      throw new RuntimeError('not_found', `path ${path} does not exist`)
    })
    if (!isWithin(resource.directory, actual)) {
      throw new RuntimeError('invalid_request', 'path resolves outside the sandbox directory')
    }
    return actual
  }

  async #writablePath(resource: LocalResource, path: string): Promise<string> {
    this.#validateRelativePath(path)
    const candidate = resolve(resource.directory, path)
    if (!isWithin(resource.directory, candidate)) {
      throw new RuntimeError('invalid_request', 'path escapes the sandbox directory')
    }
    const parent = await realpath(dirname(candidate)).catch(() => {
      throw new RuntimeError('not_found', 'parent directory does not exist')
    })
    if (!isWithin(resource.directory, parent)) {
      throw new RuntimeError('invalid_request', 'parent resolves outside the sandbox directory')
    }
    const existing = await lstat(candidate).catch(() => undefined)
    if (existing?.isSymbolicLink()) {
      throw new RuntimeError('invalid_request', 'symbolic-link writes are not allowed')
    }
    if (existing && !existing.isFile()) {
      throw new RuntimeError('invalid_request', 'write target must be a regular file')
    }
    return candidate
  }
}
