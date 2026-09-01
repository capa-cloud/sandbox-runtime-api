import type { ProviderContext, ProviderObservation, SandboxProvider } from './provider.js'
import {
  RuntimeError,
  type SandboxResource,
  type SandboxSpec,
  type SandboxState,
} from './protocol.js'

type Clock = () => Date
type IdFactory = () => string

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value))

export class InMemorySandboxRuntime {
  readonly #provider: SandboxProvider
  readonly #clock: Clock
  readonly #idFactory: IdFactory
  readonly #resources = new Map<string, SandboxResource>()
  readonly #requests = new Map<string, { sandboxId: string; fingerprint: string }>()

  constructor(
    provider: SandboxProvider,
    options: Readonly<{ clock?: Clock; idFactory?: IdFactory }> = {},
  ) {
    this.#provider = provider
    this.#clock = options.clock ?? (() => new Date())
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID())
  }

  async create(spec: SandboxSpec, context: ProviderContext): Promise<SandboxResource> {
    this.#validateSpec(spec)
    const fingerprint = stableJson(spec)
    const existingRequest = this.#requests.get(spec.clientRequestId)
    if (existingRequest) {
      if (existingRequest.fingerprint !== fingerprint) {
        throw new RuntimeError(
          'idempotency_conflict',
          `clientRequestId ${spec.clientRequestId} was reused with a different specification`,
        )
      }
      return this.get(existingRequest.sandboxId)
    }

    const manifest = await this.#provider.describe(context)
    for (const capability of spec.requiredCapabilities ?? []) {
      if (!manifest.capabilities[capability]) {
        throw new RuntimeError(
          'unsupported_capability',
          `provider ${manifest.name} does not support ${capability}`,
        )
      }
    }

    const id = this.#idFactory()
    const now = this.#clock().toISOString()
    const requested: SandboxResource = {
      id,
      generation: 1,
      state: 'requested',
      spec,
      provider: manifest.name,
      createdAt: now,
      updatedAt: now,
    }
    this.#resources.set(id, requested)
    this.#requests.set(spec.clientRequestId, { sandboxId: id, fingerprint })
    this.#writeObservation(id, { state: 'starting' })

    try {
      const observation = await this.#provider.provision(
        { sandboxId: id, generation: 1, spec },
        context,
      )
      return this.#writeObservation(id, observation)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'provider failed without an error'
      return this.#writeObservation(id, {
        state: 'failed',
        failure: { code: 'provider_unavailable', message },
      })
    }
  }

  get(id: string): SandboxResource {
    const resource = this.#resources.get(id)
    if (!resource) {
      throw new RuntimeError('not_found', `sandbox ${id} does not exist`)
    }
    return resource
  }

  list(): readonly SandboxResource[] {
    return [...this.#resources.values()]
  }

  async reconcile(id: string, context: ProviderContext): Promise<SandboxResource> {
    const current = this.get(id)
    if (current.state === 'terminated') {
      return current
    }
    const observation = await this.#provider.observe(
      { sandboxId: id, generation: current.generation },
      context,
    )
    return this.#writeObservation(id, observation)
  }

  async terminate(
    id: string,
    expectedGeneration: number,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    const current = this.get(id)
    this.#assertGeneration(current, expectedGeneration)
    if (current.state === 'terminated') {
      return current
    }
    this.#writeObservation(id, { state: 'terminating' })
    const observation = await this.#provider.terminate(
      { sandboxId: id, generation: current.generation },
      context,
    )
    return this.#writeObservation(id, observation)
  }

  async pause(
    id: string,
    expectedGeneration: number,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    const current = this.get(id)
    this.#assertGeneration(current, expectedGeneration)
    if (current.state !== 'ready') {
      throw new RuntimeError('invalid_state', `sandbox ${id} is not ready`)
    }
    if (!this.#provider.pause) {
      throw new RuntimeError('unsupported_capability', 'provider does not implement pause')
    }
    this.#writeObservation(id, { state: 'pausing' })
    return this.#writeObservation(
      id,
      await this.#provider.pause({ sandboxId: id, generation: current.generation }, context),
    )
  }

  async resume(
    id: string,
    expectedGeneration: number,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    const current = this.get(id)
    this.#assertGeneration(current, expectedGeneration)
    if (current.state !== 'paused') {
      throw new RuntimeError('invalid_state', `sandbox ${id} is not paused`)
    }
    if (!this.#provider.resume) {
      throw new RuntimeError('unsupported_capability', 'provider does not implement resume')
    }
    this.#writeObservation(id, { state: 'resuming' })
    return this.#writeObservation(
      id,
      await this.#provider.resume({ sandboxId: id, generation: current.generation }, context),
    )
  }

  #writeObservation(id: string, observation: ProviderObservation): SandboxResource {
    const current = this.get(id)
    const updated: SandboxResource = {
      ...current,
      state: observation.state,
      updatedAt: this.#clock().toISOString(),
      ...(observation.endpoint ? { endpoint: observation.endpoint } : {}),
      ...(observation.extensions ? { providerExtensions: observation.extensions } : {}),
      ...(observation.failure ? { failure: observation.failure } : {}),
    }
    this.#resources.set(id, updated)
    return updated
  }

  #assertGeneration(resource: SandboxResource, expectedGeneration: number): void {
    if (resource.generation !== expectedGeneration) {
      throw new RuntimeError(
        'generation_conflict',
        `expected generation ${expectedGeneration}, observed ${resource.generation}`,
      )
    }
  }

  #validateSpec(spec: SandboxSpec): void {
    if (!spec.clientRequestId.trim()) {
      throw new RuntimeError('invalid_request', 'clientRequestId is required')
    }
    if (spec.image && spec.template) {
      throw new RuntimeError('invalid_request', 'image and template are mutually exclusive')
    }
  }
}

export const isTerminalState = (state: SandboxState): boolean =>
  state === 'terminated' || state === 'failed'
