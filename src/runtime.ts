import type { ProviderContext, ProviderObservation, SandboxProvider } from './provider.js'
import {
  type CapabilityName,
  type CommandRequest,
  type CommandResult,
  type FileEntry,
  type FileReadResult,
  type FileWriteRequest,
  type JsonObject,
  type JsonValue,
  protocolVersion,
  capabilityNames,
  type ProviderManifest,
  RuntimeError,
  type RuntimeInfo,
  type SandboxEvent,
  type SandboxEventType,
  type SandboxResource,
  type SandboxSpec,
  type SandboxState,
} from './protocol.js'

type Clock = () => Date
type IdFactory = () => string
type EventListener = (event: SandboxEvent) => void
type ListenerErrorHandler = (error: unknown, event: SandboxEvent) => void

const transitions: Readonly<Record<SandboxState, readonly SandboxState[]>> = {
  requested: ['requested', 'starting', 'terminating', 'failed'],
  starting: ['starting', 'ready', 'terminating', 'failed'],
  ready: ['ready', 'pausing', 'terminating', 'failed'],
  pausing: ['pausing', 'paused', 'ready', 'terminating', 'failed'],
  paused: ['paused', 'resuming', 'terminating', 'failed'],
  resuming: ['resuming', 'ready', 'paused', 'terminating', 'failed'],
  terminating: ['terminating', 'terminated', 'failed'],
  terminated: ['terminated', 'requested'],
  failed: ['failed', 'terminating', 'terminated'],
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
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
const extensionKeyPattern = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9_.-]*$/

const isJsonValue = (value: unknown, seen = new WeakSet<object>()): value is JsonValue => {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
      Object.values(value).every((entry) => isJsonValue(entry, seen))
  seen.delete(value)
  return valid
}

const strictBase64 = (value: unknown): Buffer | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s/g, '')
  if (
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    return undefined
  }
  return Buffer.from(normalized, 'base64')
}

export class InMemorySandboxRuntime {
  readonly #provider: SandboxProvider
  readonly #clock: Clock
  readonly #idFactory: IdFactory
  readonly #maxEvents: number
  readonly #listenerErrorHandler: ListenerErrorHandler
  readonly #resources = new Map<string, SandboxResource>()
  readonly #requests = new Map<
    string,
    { sandboxId: string; generation: number; fingerprint: string }
  >()
  readonly #inflightCreates = new Map<
    string,
    { fingerprint: string; promise: Promise<SandboxResource> }
  >()
  readonly #locks = new Map<string, Promise<void>>()
  readonly #events: SandboxEvent[] = []
  readonly #listeners = new Set<EventListener>()
  #nextCursor = 1

  constructor(
    provider: SandboxProvider,
    options: Readonly<{
      clock?: Clock
      idFactory?: IdFactory
      maxEvents?: number
      listenerErrorHandler?: ListenerErrorHandler
    }> = {},
  ) {
    this.#provider = provider
    this.#clock = options.clock ?? (() => new Date())
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID())
    this.#maxEvents = options.maxEvents ?? 10_000
    this.#listenerErrorHandler = options.listenerErrorHandler ?? (() => {})
    if (!Number.isInteger(this.#maxEvents) || this.#maxEvents < 1) {
      throw new RuntimeError('invalid_request', 'maxEvents must be a positive integer')
    }
  }

  async info(context: ProviderContext): Promise<RuntimeInfo> {
    return { protocolVersion, provider: await this.#describeProvider(context) }
  }

  create(spec: SandboxSpec, context: ProviderContext): Promise<SandboxResource> {
    try {
      this.#validateSpec(spec)
    } catch (error) {
      return Promise.reject(error)
    }
    const fingerprint = stableJson(spec)
    const existingRequest = this.#requests.get(spec.clientRequestId)
    if (existingRequest) {
      if (existingRequest.fingerprint !== fingerprint) {
        return Promise.reject(
          new RuntimeError(
            'idempotency_conflict',
            `clientRequestId ${spec.clientRequestId} was reused with a different specification`,
          ),
        )
      }
      const resource = this.get(existingRequest.sandboxId)
      if (resource.generation !== existingRequest.generation) {
        return Promise.reject(
          new RuntimeError(
            'idempotency_conflict',
            `clientRequestId ${spec.clientRequestId} belongs to an older generation`,
          ),
        )
      }
      return Promise.resolve(resource)
    }

    const inflight = this.#inflightCreates.get(spec.clientRequestId)
    if (inflight) {
      if (inflight.fingerprint !== fingerprint) {
        return Promise.reject(
          new RuntimeError(
            'idempotency_conflict',
            `clientRequestId ${spec.clientRequestId} has a different create in flight`,
          ),
        )
      }
      return inflight.promise
    }

    const promise = this.#createNew(spec, fingerprint, context).finally(() => {
      const current = this.#inflightCreates.get(spec.clientRequestId)
      if (current?.promise === promise) this.#inflightCreates.delete(spec.clientRequestId)
    })
    this.#inflightCreates.set(spec.clientRequestId, { fingerprint, promise })
    return promise
  }

  get(id: string): SandboxResource {
    const resource = this.#resources.get(id)
    if (!resource) throw new RuntimeError('not_found', `sandbox ${id} does not exist`)
    return resource
  }

  list(): readonly SandboxResource[] {
    return [...this.#resources.values()]
  }

  events(afterCursor = 0, sandboxId?: string): readonly SandboxEvent[] {
    if (!Number.isInteger(afterCursor) || afterCursor < 0) {
      throw new RuntimeError('invalid_request', 'afterCursor must be a non-negative integer')
    }
    const oldestCursor = this.#events[0]?.cursor
    if (afterCursor > 0 && oldestCursor !== undefined && afterCursor < oldestCursor - 1) {
      throw new RuntimeError(
        'event_history_unavailable',
        `event history starts at cursor ${oldestCursor}`,
      )
    }
    return this.#events.filter(
      (event) => event.cursor > afterCursor && (!sandboxId || event.sandboxId === sandboxId),
    )
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  reconcile(id: string, context: ProviderContext): Promise<SandboxResource> {
    return this.#withLock(id, async () => {
      const current = this.get(id)
      if (current.state === 'terminated') return current
      try {
        const observation = await this.#provider.observe(
          { sandboxId: id, generation: current.generation },
          context,
        )
        return this.#writeObservation(id, observation)
      } catch (error) {
        throw this.#providerError('observe', error)
      }
    })
  }

  terminate(
    id: string,
    expectedGeneration: number,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    return this.#withLock(id, async () => {
      const current = this.get(id)
      this.#assertGeneration(current, expectedGeneration)
      if (current.state === 'terminated') return current
      if (!['requested', 'starting', 'ready', 'paused', 'failed'].includes(current.state)) {
        throw new RuntimeError(
          'invalid_state',
          `sandbox ${id} cannot terminate from ${current.state}`,
        )
      }
      this.#writeObservation(id, { state: 'terminating' })
      try {
        return this.#writeObservation(
          id,
          await this.#provider.terminate(
            { sandboxId: id, generation: current.generation },
            context,
          ),
        )
      } catch (error) {
        this.#writeObservation(id, {
          state: 'failed',
          failure: { code: 'provider_unavailable', message: this.#errorMessage(error) },
        })
        throw this.#providerError('terminate', error)
      }
    })
  }

  pause(
    id: string,
    expectedGeneration: number,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    return this.#withLock(id, async () => {
      const current = this.get(id)
      this.#assertGeneration(current, expectedGeneration)
      if (current.state !== 'ready') {
        throw new RuntimeError('invalid_state', `sandbox ${id} is not ready`)
      }
      await this.#requireCapability('pauseResume', context)
      if (!this.#provider.pause) {
        throw new RuntimeError('provider_protocol_error', 'provider does not implement pause')
      }
      this.#writeObservation(id, { state: 'pausing' })
      try {
        return this.#writeObservation(
          id,
          await this.#provider.pause({ sandboxId: id, generation: current.generation }, context),
        )
      } catch (error) {
        throw this.#providerError('pause', error)
      }
    })
  }

  resume(
    id: string,
    expectedGeneration: number,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    return this.#withLock(id, async () => {
      const current = this.get(id)
      this.#assertGeneration(current, expectedGeneration)
      if (current.state !== 'paused') {
        throw new RuntimeError('invalid_state', `sandbox ${id} is not paused`)
      }
      await this.#requireCapability('pauseResume', context)
      if (!this.#provider.resume) {
        throw new RuntimeError('provider_protocol_error', 'provider does not implement resume')
      }
      this.#writeObservation(id, { state: 'resuming' })
      try {
        return this.#writeObservation(
          id,
          await this.#provider.resume({ sandboxId: id, generation: current.generation }, context),
        )
      } catch (error) {
        throw this.#providerError('resume', error)
      }
    })
  }

  recreate(
    id: string,
    expectedGeneration: number,
    spec: SandboxSpec,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    this.#validateSpec(spec)
    this.#validateExpectedGeneration(expectedGeneration)
    return this.#withLock(id, async () => {
      const current = this.get(id)
      const fingerprint = stableJson(spec)
      const existingRequest = this.#requests.get(spec.clientRequestId)
      if (existingRequest) {
        if (
          existingRequest.fingerprint !== fingerprint ||
          existingRequest.sandboxId !== id ||
          current.spec.clientRequestId !== spec.clientRequestId ||
          current.generation !== expectedGeneration + 1 ||
          existingRequest.generation !== current.generation
        ) {
          throw new RuntimeError('idempotency_conflict', 'recreate clientRequestId is already used')
        }
        return current
      }
      this.#assertGeneration(current, expectedGeneration)
      if (current.state !== 'terminated') {
        throw new RuntimeError('invalid_state', `sandbox ${id} is not terminated`)
      }
      const manifest = await this.#describeProvider(context)
      this.#assertCapabilities(spec, manifest.capabilities)
      const next: SandboxResource = {
        id,
        generation: current.generation + 1,
        state: 'requested',
        spec,
        provider: manifest.name,
        createdAt: current.createdAt,
        updatedAt: this.#clock().toISOString(),
      }
      this.#resources.set(id, next)
      this.#requests.set(spec.clientRequestId, {
        sandboxId: id,
        generation: next.generation,
        fingerprint,
      })
      this.#emit('sandbox.created', next, { recreated: true })
      this.#writeObservation(id, { state: 'starting' })
      let observation: ProviderObservation
      try {
        observation = await this.#provider.provision(
          { sandboxId: id, generation: next.generation, spec },
          context,
        )
      } catch (error) {
        return this.#writeObservation(id, {
          state: 'failed',
          failure: { code: 'provider_unavailable', message: this.#errorMessage(error) },
        })
      }
      return this.#writeObservation(id, observation)
    })
  }

  execute(id: string, request: CommandRequest, context: ProviderContext): Promise<CommandResult> {
    return (async () => {
      this.#validateCommandRequest(request)
      const resource = await this.#readyWithCapability(
        id,
        request.expectedGeneration,
        'commandExecution',
        context,
      )
      if (!this.#provider.execute) {
        throw new RuntimeError('provider_protocol_error', 'provider does not implement execute')
      }
      try {
        const result = await this.#provider.execute(
          { sandboxId: id, generation: resource.generation },
          request,
          context,
        )
        this.#assertCommandResult(result)
        this.#emit('sandbox.command_completed', resource, {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          cancelled: result.cancelled,
          truncated: result.truncated,
        })
        return result
      } catch (error) {
        if (error instanceof RuntimeError) throw error
        throw this.#providerError('execute', error)
      }
    })()
  }

  readFile(
    id: string,
    expectedGeneration: number,
    path: string,
    context: ProviderContext,
  ): Promise<FileReadResult> {
    return (async () => {
      this.#validatePath(path)
      const resource = await this.#readyWithCapability(
        id,
        expectedGeneration,
        'fileAccess',
        context,
      )
      if (!this.#provider.readFile) {
        throw new RuntimeError('provider_protocol_error', 'provider does not implement readFile')
      }
      try {
        const result = await this.#provider.readFile(
          { sandboxId: id, generation: resource.generation },
          path,
          context,
        )
        this.#assertFileResult(result, path)
        return result
      } catch (error) {
        throw this.#providerError('readFile', error)
      }
    })()
  }

  writeFile(
    id: string,
    request: FileWriteRequest,
    context: ProviderContext,
  ): Promise<FileReadResult> {
    return (async () => {
      this.#validateFileWriteRequest(request)
      const resource = await this.#readyWithCapability(
        id,
        request.expectedGeneration,
        'fileAccess',
        context,
      )
      if (!this.#provider.writeFile) {
        throw new RuntimeError('provider_protocol_error', 'provider does not implement writeFile')
      }
      let result: FileReadResult
      try {
        result = await this.#provider.writeFile(
          { sandboxId: id, generation: resource.generation },
          request,
          context,
        )
        this.#assertFileResult(result, request.path, request.contentBase64)
      } catch (error) {
        throw this.#providerError('writeFile', error)
      }
      this.#emit('sandbox.file_written', resource, { path: result.path, size: result.size })
      return result
    })()
  }

  listFiles(
    id: string,
    expectedGeneration: number,
    path: string,
    context: ProviderContext,
  ): Promise<readonly FileEntry[]> {
    return (async () => {
      this.#validatePath(path)
      const resource = await this.#readyWithCapability(
        id,
        expectedGeneration,
        'fileAccess',
        context,
      )
      if (!this.#provider.listFiles) {
        throw new RuntimeError('provider_protocol_error', 'provider does not implement listFiles')
      }
      try {
        const entries = await this.#provider.listFiles(
          { sandboxId: id, generation: resource.generation },
          path,
          context,
        )
        this.#assertFileEntries(entries)
        return entries
      } catch (error) {
        throw this.#providerError('listFiles', error)
      }
    })()
  }

  async #createNew(
    spec: SandboxSpec,
    fingerprint: string,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    const manifest = await this.#describeProvider(context)
    this.#assertCapabilities(spec, manifest.capabilities)
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
    this.#requests.set(spec.clientRequestId, {
      sandboxId: id,
      generation: requested.generation,
      fingerprint,
    })
    this.#emit('sandbox.created', requested, { recreated: false })
    this.#writeObservation(id, { state: 'starting' })
    let observation: ProviderObservation
    try {
      observation = await this.#provider.provision(
        { sandboxId: id, generation: requested.generation, spec },
        context,
      )
    } catch (error) {
      return this.#writeObservation(id, {
        state: 'failed',
        failure: { code: 'provider_unavailable', message: this.#errorMessage(error) },
      })
    }
    return this.#writeObservation(id, observation)
  }

  #writeObservation(id: string, observation: ProviderObservation): SandboxResource {
    const current = this.get(id)
    if (observation.extensions && !isJsonValue(observation.extensions)) {
      throw new RuntimeError(
        'provider_protocol_error',
        'provider extensions must contain only JSON values',
      )
    }
    if (
      observation.extensions &&
      Object.keys(observation.extensions).some((key) => !extensionKeyPattern.test(key))
    ) {
      throw new RuntimeError(
        'provider_protocol_error',
        'provider extension keys must be namespaced',
      )
    }
    if (observation.failure && observation.state !== 'failed') {
      throw new RuntimeError('provider_protocol_error', 'provider failure requires failed state')
    }
    if (observation.state === 'failed' && !observation.failure) {
      throw new RuntimeError('provider_protocol_error', 'failed provider state requires failure')
    }
    if (observation.endpoint) {
      try {
        const endpoint = new URL(observation.endpoint.baseUrl)
        if (!['http:', 'https:'].includes(endpoint.protocol))
          throw new Error('unsupported protocol')
      } catch {
        throw new RuntimeError('provider_protocol_error', 'provider endpoint must be an HTTP URL')
      }
    }
    if (!transitions[current.state].includes(observation.state)) {
      throw new RuntimeError(
        'provider_protocol_error',
        `provider attempted invalid transition ${current.state} -> ${observation.state}`,
      )
    }
    const endpoint = observation.endpoint ?? current.endpoint
    const providerExtensions = observation.extensions ?? current.providerExtensions
    const updated: SandboxResource = {
      id: current.id,
      generation: current.generation,
      state: observation.state,
      spec: current.spec,
      provider: current.provider,
      createdAt: current.createdAt,
      updatedAt: this.#clock().toISOString(),
      ...(observation.state !== 'terminated' && endpoint ? { endpoint } : {}),
      ...(providerExtensions ? { providerExtensions } : {}),
      ...(observation.failure ? { failure: observation.failure } : {}),
    }
    this.#resources.set(id, updated)
    if (current.state !== updated.state) {
      this.#emit('sandbox.state_changed', updated, {
        previousState: current.state,
        state: updated.state,
      })
    }
    return updated
  }

  #emit(type: SandboxEventType, resource: SandboxResource, data: JsonObject): void {
    const event: SandboxEvent = {
      cursor: this.#nextCursor++,
      type,
      sandboxId: resource.id,
      generation: resource.generation,
      timestamp: this.#clock().toISOString(),
      data,
    }
    this.#events.push(event)
    if (this.#events.length > this.#maxEvents) {
      this.#events.splice(0, this.#events.length - this.#maxEvents)
    }
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch (error) {
        try {
          this.#listenerErrorHandler(error, event)
        } catch {
          // Observer failures must not change portable runtime behavior.
        }
      }
    }
  }

  async #readyWithCapability(
    id: string,
    expectedGeneration: number,
    capability: CapabilityName,
    context: ProviderContext,
  ): Promise<SandboxResource> {
    const resource = this.get(id)
    this.#assertGeneration(resource, expectedGeneration)
    if (resource.state !== 'ready') {
      throw new RuntimeError('invalid_state', `sandbox ${id} is not ready`)
    }
    await this.#requireCapability(capability, context)
    const current = this.get(id)
    this.#assertGeneration(current, expectedGeneration)
    if (current.state !== 'ready') {
      throw new RuntimeError('invalid_state', `sandbox ${id} is not ready`)
    }
    return current
  }

  async #requireCapability(capability: CapabilityName, context: ProviderContext): Promise<void> {
    const manifest = await this.#describeProvider(context)
    if (!manifest.capabilities[capability]) {
      throw new RuntimeError(
        'unsupported_capability',
        `provider ${manifest.name} does not support ${capability}`,
      )
    }
  }

  #assertCapabilities(
    spec: SandboxSpec,
    capabilities: Readonly<Record<CapabilityName, boolean>>,
  ): void {
    if (spec.image && !capabilities.imageReference) {
      throw new RuntimeError('unsupported_capability', 'provider does not support imageReference')
    }
    if (spec.template && !capabilities.templateReference) {
      throw new RuntimeError(
        'unsupported_capability',
        'provider does not support templateReference',
      )
    }
    if (spec.resources && !capabilities.resourceLimits) {
      throw new RuntimeError('unsupported_capability', 'provider does not support resourceLimits')
    }
    for (const capability of spec.requiredCapabilities ?? []) {
      if (!capabilities[capability]) {
        throw new RuntimeError('unsupported_capability', `provider does not support ${capability}`)
      }
    }
  }

  #assertGeneration(resource: SandboxResource, expectedGeneration: number): void {
    this.#validateExpectedGeneration(expectedGeneration)
    if (resource.generation !== expectedGeneration) {
      throw new RuntimeError(
        'generation_conflict',
        `expected generation ${expectedGeneration}, observed ${resource.generation}`,
      )
    }
  }

  #validateExpectedGeneration(expectedGeneration: number): void {
    if (!Number.isInteger(expectedGeneration) || expectedGeneration < 1) {
      throw new RuntimeError('invalid_request', 'expectedGeneration must be a positive integer')
    }
  }

  #validateSpec(spec: SandboxSpec): void {
    if (!spec.clientRequestId.trim()) {
      throw new RuntimeError('invalid_request', 'clientRequestId is required')
    }
    if (spec.image && spec.template) {
      throw new RuntimeError('invalid_request', 'image and template are mutually exclusive')
    }
    if (spec.image !== undefined && !spec.image.trim()) {
      throw new RuntimeError('invalid_request', 'image must not be empty')
    }
    if (spec.template !== undefined && !spec.template.trim()) {
      throw new RuntimeError('invalid_request', 'template must not be empty')
    }
    for (const [name, value] of Object.entries(spec.resources ?? {})) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new RuntimeError('invalid_request', `${name} must be a positive integer`)
      }
    }
    if (
      new Set(spec.requiredCapabilities ?? []).size !== (spec.requiredCapabilities ?? []).length
    ) {
      throw new RuntimeError('invalid_request', 'requiredCapabilities must not contain duplicates')
    }
    if (spec.extensions && !isJsonValue(spec.extensions)) {
      throw new RuntimeError('invalid_request', 'extensions must contain only JSON values')
    }
    if (
      spec.extensions &&
      Object.keys(spec.extensions).some((key) => !extensionKeyPattern.test(key))
    ) {
      throw new RuntimeError('invalid_request', 'extension keys must be namespaced')
    }
  }

  #validateCommandRequest(request: CommandRequest): void {
    this.#validateExpectedGeneration(request.expectedGeneration)
    if (
      !Array.isArray(request.argv) ||
      request.argv.length === 0 ||
      request.argv.some((argument) => typeof argument !== 'string' || argument.includes('\0'))
    ) {
      throw new RuntimeError('invalid_request', 'argv must contain at least one valid string')
    }
    if (request.cwd !== undefined) this.#validatePath(request.cwd)
    if (
      request.timeoutSeconds !== undefined &&
      (!Number.isFinite(request.timeoutSeconds) ||
        request.timeoutSeconds <= 0 ||
        request.timeoutSeconds > 3600)
    ) {
      throw new RuntimeError('invalid_request', 'timeoutSeconds must be in (0, 3600]')
    }
    if (
      request.maxOutputBytes !== undefined &&
      (!Number.isInteger(request.maxOutputBytes) ||
        request.maxOutputBytes < 1 ||
        request.maxOutputBytes > 10 * 1024 * 1024)
    ) {
      throw new RuntimeError('invalid_request', 'maxOutputBytes must be in [1, 10485760]')
    }
    for (const [name, value] of Object.entries(request.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes('\0')) {
        throw new RuntimeError('invalid_request', `invalid environment entry ${name}`)
      }
    }
  }

  #validateFileWriteRequest(request: FileWriteRequest): void {
    this.#validateExpectedGeneration(request.expectedGeneration)
    this.#validatePath(request.path)
    const normalized = request.contentBase64.replace(/\s/g, '')
    if (
      normalized.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
    ) {
      throw new RuntimeError('invalid_request', 'contentBase64 is not valid base64')
    }
  }

  #validatePath(path: string): void {
    if (typeof path !== 'string' || !path || path.includes('\0')) {
      throw new RuntimeError('invalid_request', 'path must be a non-empty string')
    }
  }

  #assertCommandResult(result: unknown): asserts result is CommandResult {
    if (
      !result ||
      typeof result !== 'object' ||
      !('exitCode' in result) ||
      !(result.exitCode === null || Number.isInteger(result.exitCode)) ||
      !('stdout' in result) ||
      typeof result.stdout !== 'string' ||
      !('stderr' in result) ||
      typeof result.stderr !== 'string' ||
      !('timedOut' in result) ||
      typeof result.timedOut !== 'boolean' ||
      !('cancelled' in result) ||
      typeof result.cancelled !== 'boolean' ||
      !('truncated' in result) ||
      typeof result.truncated !== 'boolean' ||
      !('startedAt' in result) ||
      typeof result.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(result.startedAt)) ||
      !('finishedAt' in result) ||
      typeof result.finishedAt !== 'string' ||
      !Number.isFinite(Date.parse(result.finishedAt))
    ) {
      throw new RuntimeError(
        'provider_protocol_error',
        'provider returned an invalid command result',
      )
    }
  }

  #assertFileResult(result: unknown, path: string, expectedContentBase64?: string): void {
    if (!result || typeof result !== 'object') {
      throw new RuntimeError('provider_protocol_error', 'provider returned an invalid file result')
    }
    const content = 'contentBase64' in result ? strictBase64(result.contentBase64) : undefined
    if (
      !('path' in result) ||
      result.path !== path ||
      !content ||
      !('size' in result) ||
      !Number.isInteger(result.size) ||
      result.size !== content.byteLength
    ) {
      throw new RuntimeError('provider_protocol_error', 'provider returned an invalid file result')
    }
    const expected = expectedContentBase64 ? strictBase64(expectedContentBase64) : undefined
    if (expected && !content.equals(expected)) {
      throw new RuntimeError('provider_protocol_error', 'provider changed written file content')
    }
  }

  #assertFileEntries(entries: unknown): asserts entries is readonly FileEntry[] {
    if (
      !Array.isArray(entries) ||
      entries.some(
        (entry) =>
          !entry ||
          typeof entry !== 'object' ||
          !('path' in entry) ||
          typeof entry.path !== 'string' ||
          !entry.path ||
          !('kind' in entry) ||
          !['file', 'directory'].includes(entry.kind as string) ||
          !('size' in entry) ||
          !Number.isInteger(entry.size) ||
          (entry.size as number) < 0,
      )
    ) {
      throw new RuntimeError('provider_protocol_error', 'provider returned invalid file entries')
    }
  }

  async #withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(id) ?? Promise.resolve()
    let release = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = previous.then(() => current)
    this.#locks.set(id, chained)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#locks.get(id) === chained) this.#locks.delete(id)
    }
  }

  #errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'provider failed without an error'
  }

  #providerError(operation: string, error: unknown): RuntimeError {
    if (error instanceof RuntimeError) return error
    return new RuntimeError(
      'provider_unavailable',
      `provider ${operation} failed: ${this.#errorMessage(error)}`,
    )
  }

  async #describeProvider(context: ProviderContext): Promise<ProviderManifest> {
    let manifest: ProviderManifest
    try {
      manifest = await this.#provider.describe(context)
    } catch (error) {
      throw this.#providerError('describe', error)
    }
    if (
      !manifest ||
      typeof manifest.name !== 'string' ||
      !manifest.name.trim() ||
      typeof manifest.version !== 'string' ||
      !manifest.version.trim() ||
      typeof manifest.runtimeClass !== 'string' ||
      !manifest.runtimeClass.trim() ||
      !manifest.capabilities ||
      typeof manifest.capabilities !== 'object' ||
      capabilityNames.some((name) => typeof manifest.capabilities[name] !== 'boolean')
    ) {
      throw new RuntimeError('provider_protocol_error', 'provider manifest is incomplete')
    }
    return manifest
  }
}

export const isTerminalState = (state: SandboxState): boolean =>
  state === 'terminated' || state === 'failed'
