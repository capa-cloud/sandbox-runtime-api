import type {
  ProviderContext,
  ProviderObservation,
  ProviderProvisionRequest,
  ProviderSandboxKey,
  SandboxProvider,
} from '../provider.js'
import type {
  CommandRequest,
  CommandResult,
  FileEntry,
  FileReadResult,
  FileWriteRequest,
  ProviderManifest,
  RuntimeCapabilities,
} from '../protocol.js'

const allCapabilities = (overrides: Partial<RuntimeCapabilities> = {}): RuntimeCapabilities => ({
  commandExecution: true,
  fileAccess: true,
  interactiveTerminal: false,
  portForwarding: false,
  pauseResume: true,
  filesystemSnapshot: false,
  memorySnapshot: false,
  persistentVolume: false,
  networkPolicy: false,
  imageReference: false,
  templateReference: false,
  resourceLimits: false,
  ...overrides,
})

export class MockSandboxProvider implements SandboxProvider {
  readonly #resources = new Map<string, ProviderObservation>()
  readonly #files = new Map<string, Map<string, Uint8Array>>()
  readonly #manifest: ProviderManifest

  constructor(capabilities: Partial<RuntimeCapabilities> = {}) {
    this.#manifest = {
      name: 'mock',
      version: '0.1.0-dev',
      runtimeClass: 'mock-process',
      capabilities: allCapabilities(capabilities),
    }
  }

  async describe(_context: ProviderContext): Promise<ProviderManifest> {
    return this.#manifest
  }

  async provision(
    request: ProviderProvisionRequest,
    _context: ProviderContext,
  ): Promise<ProviderObservation> {
    const observation: ProviderObservation = {
      state: 'ready',
      endpoint: { baseUrl: `http://127.0.0.1/mock/${request.sandboxId}` },
      extensions: { 'mock.resourceId': `${request.sandboxId}:${request.generation}` },
    }
    this.#resources.set(this.#key(request), observation)
    this.#files.set(this.#key(request), new Map())
    return observation
  }

  async observe(key: ProviderSandboxKey, _context: ProviderContext): Promise<ProviderObservation> {
    const observation = this.#resources.get(this.#key(key))
    if (!observation) {
      return { state: 'failed', failure: { code: 'not_found', message: 'mock resource missing' } }
    }
    return observation
  }

  async terminate(
    key: ProviderSandboxKey,
    _context: ProviderContext,
  ): Promise<ProviderObservation> {
    const observation: ProviderObservation = { state: 'terminated' }
    this.#resources.set(this.#key(key), observation)
    this.#files.delete(this.#key(key))
    return observation
  }

  async pause(key: ProviderSandboxKey, _context: ProviderContext): Promise<ProviderObservation> {
    const observation: ProviderObservation = { state: 'paused' }
    this.#resources.set(this.#key(key), observation)
    return observation
  }

  async resume(key: ProviderSandboxKey, _context: ProviderContext): Promise<ProviderObservation> {
    const observation: ProviderObservation = {
      state: 'ready',
      endpoint: { baseUrl: `http://127.0.0.1/mock/${key.sandboxId}` },
    }
    this.#resources.set(this.#key(key), observation)
    return observation
  }

  async execute(
    _key: ProviderSandboxKey,
    request: CommandRequest,
    _context: ProviderContext,
  ): Promise<CommandResult> {
    if (request.argv.length === 0) throw new Error('argv is required')
    const now = new Date().toISOString()
    return {
      exitCode: 0,
      stdout: request.argv.join(' '),
      stderr: '',
      timedOut: false,
      cancelled: false,
      truncated: false,
      startedAt: now,
      finishedAt: now,
    }
  }

  async readFile(
    key: ProviderSandboxKey,
    path: string,
    _context: ProviderContext,
  ): Promise<FileReadResult> {
    const content = this.#fileMap(key).get(path)
    if (!content) throw new Error(`file ${path} does not exist`)
    return {
      path,
      contentBase64: Buffer.from(content).toString('base64'),
      size: content.byteLength,
    }
  }

  async writeFile(
    key: ProviderSandboxKey,
    request: FileWriteRequest,
    _context: ProviderContext,
  ): Promise<FileReadResult> {
    const content = Buffer.from(request.contentBase64, 'base64')
    this.#fileMap(key).set(request.path, content)
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
    const prefix = path === '.' || path === '' ? '' : `${path.replace(/\/$/, '')}/`
    return [...this.#fileMap(key).entries()]
      .filter(([name]) => {
        if (!name.startsWith(prefix)) return false
        return !name.slice(prefix.length).includes('/')
      })
      .map(([name, content]) => ({ path: name, kind: 'file' as const, size: content.byteLength }))
      .sort((left, right) => left.path.localeCompare(right.path))
  }

  #key(key: ProviderSandboxKey): string {
    return `${key.sandboxId}:${key.generation}`
  }

  #fileMap(key: ProviderSandboxKey): Map<string, Uint8Array> {
    const files = this.#files.get(this.#key(key))
    if (!files) throw new Error('mock resource missing')
    return files
  }
}
