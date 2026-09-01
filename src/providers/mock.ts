import type {
  ProviderContext,
  ProviderObservation,
  ProviderProvisionRequest,
  ProviderSandboxKey,
  SandboxProvider,
} from '../provider.js'
import type { ProviderManifest, RuntimeCapabilities } from '../protocol.js'

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
  ...overrides,
})

export class MockSandboxProvider implements SandboxProvider {
  readonly #resources = new Map<string, ProviderObservation>()
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
    this.#resources.set(request.sandboxId, observation)
    return observation
  }

  async observe(key: ProviderSandboxKey, _context: ProviderContext): Promise<ProviderObservation> {
    const observation = this.#resources.get(key.sandboxId)
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
    this.#resources.set(key.sandboxId, observation)
    return observation
  }

  async pause(key: ProviderSandboxKey, _context: ProviderContext): Promise<ProviderObservation> {
    const observation: ProviderObservation = { state: 'paused' }
    this.#resources.set(key.sandboxId, observation)
    return observation
  }

  async resume(key: ProviderSandboxKey, _context: ProviderContext): Promise<ProviderObservation> {
    const observation: ProviderObservation = {
      state: 'ready',
      endpoint: { baseUrl: `http://127.0.0.1/mock/${key.sandboxId}` },
    }
    this.#resources.set(key.sandboxId, observation)
    return observation
  }
}
