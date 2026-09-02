import type {
  CommandRequest,
  CommandResult,
  FileEntry,
  FileReadResult,
  RuntimeInfo,
  SandboxEvent,
  SandboxResource,
  SandboxSpec,
} from './protocol.js'
import { RuntimeError, runtimeErrorCodes } from './protocol.js'

type RequestOptions = Readonly<{
  method?: string | undefined
  body?: unknown
  signal?: AbortSignal | undefined
}>

export class SandboxRuntimeClient {
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  constructor(baseUrl: string, fetchImplementation: typeof fetch = fetch) {
    this.#baseUrl = baseUrl.replace(/\/$/, '')
    this.#fetch = fetchImplementation
  }

  getRuntimeInfo(signal?: AbortSignal): Promise<RuntimeInfo> {
    return this.#request('/v1/runtime', { signal })
  }

  create(spec: SandboxSpec, signal?: AbortSignal): Promise<SandboxResource> {
    return this.#request('/v1/sandboxes', { method: 'POST', body: spec, signal })
  }

  async list(signal?: AbortSignal): Promise<readonly SandboxResource[]> {
    return (await this.#request<{ sandboxes: SandboxResource[] }>('/v1/sandboxes', { signal }))
      .sandboxes
  }

  get(id: string, signal?: AbortSignal): Promise<SandboxResource> {
    return this.#request(`/v1/sandboxes/${encodeURIComponent(id)}`, { signal })
  }

  reconcile(id: string, signal?: AbortSignal): Promise<SandboxResource> {
    return this.#action(id, 'reconcile', {}, signal)
  }

  terminate(
    id: string,
    expectedGeneration: number,
    signal?: AbortSignal,
  ): Promise<SandboxResource> {
    return this.#action(id, 'terminate', { expectedGeneration }, signal)
  }

  pause(id: string, expectedGeneration: number, signal?: AbortSignal): Promise<SandboxResource> {
    return this.#action(id, 'pause', { expectedGeneration }, signal)
  }

  resume(id: string, expectedGeneration: number, signal?: AbortSignal): Promise<SandboxResource> {
    return this.#action(id, 'resume', { expectedGeneration }, signal)
  }

  recreate(
    id: string,
    expectedGeneration: number,
    spec: SandboxSpec,
    signal?: AbortSignal,
  ): Promise<SandboxResource> {
    return this.#action(id, 'recreate', { expectedGeneration, spec }, signal)
  }

  execute(id: string, request: CommandRequest, signal?: AbortSignal): Promise<CommandResult> {
    return this.#request(`/v1/sandboxes/${encodeURIComponent(id)}/commands`, {
      method: 'POST',
      body: request,
      signal,
    })
  }

  readFile(
    id: string,
    expectedGeneration: number,
    path: string,
    signal?: AbortSignal,
  ): Promise<FileReadResult> {
    const query = new URLSearchParams({ path, expectedGeneration: String(expectedGeneration) })
    return this.#request(`/v1/sandboxes/${encodeURIComponent(id)}/files/content?${query}`, {
      signal,
    })
  }

  writeFile(
    id: string,
    expectedGeneration: number,
    path: string,
    contentBase64: string,
    signal?: AbortSignal,
  ): Promise<FileReadResult> {
    return this.#request(`/v1/sandboxes/${encodeURIComponent(id)}/files/content`, {
      method: 'PUT',
      body: { expectedGeneration, path, contentBase64 },
      signal,
    })
  }

  async listFiles(
    id: string,
    expectedGeneration: number,
    path = '.',
    signal?: AbortSignal,
  ): Promise<readonly FileEntry[]> {
    const query = new URLSearchParams({ path, expectedGeneration: String(expectedGeneration) })
    return (
      await this.#request<{ entries: FileEntry[] }>(
        `/v1/sandboxes/${encodeURIComponent(id)}/files/entries?${query}`,
        { signal },
      )
    ).entries
  }

  async listEvents(
    after = 0,
    sandboxId?: string,
    signal?: AbortSignal,
  ): Promise<readonly SandboxEvent[]> {
    const query = new URLSearchParams({ after: String(after) })
    if (sandboxId) query.set('sandboxId', sandboxId)
    return (await this.#request<{ events: SandboxEvent[] }>(`/v1/events?${query}`, { signal }))
      .events
  }

  async *streamEvents(
    options: Readonly<{ after?: number; sandboxId?: string; signal?: AbortSignal }> = {},
  ): AsyncGenerator<SandboxEvent> {
    const query = new URLSearchParams({ after: String(options.after ?? 0) })
    if (options.sandboxId) query.set('sandboxId', options.sandboxId)
    const response = await this.#fetch(`${this.#baseUrl}/v1/events/stream?${query}`, {
      headers: { accept: 'text/event-stream' },
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!response.ok || !response.body) await this.#throwResponse(response)
    const body = response.body
    if (!body) throw new RuntimeError('provider_unavailable', 'event stream has no response body')
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
        const preserveTrailingCarriageReturn = !done && buffer.endsWith('\r')
        const complete = preserveTrailingCarriageReturn ? buffer.slice(0, -1) : buffer
        buffer = complete.replace(/\r\n?/g, '\n') + (preserveTrailingCarriageReturn ? '\r' : '')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n')
          if (data) yield JSON.parse(data) as SandboxEvent
          boundary = buffer.indexOf('\n\n')
        }
        if (done) return
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }

  #action(
    id: string,
    action: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<SandboxResource> {
    return this.#request(
      `/v1/sandboxes/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
      { method: 'POST', body, signal },
    )
  }

  async #request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: options.method ?? 'GET',
      ...(options.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!response.ok) await this.#throwResponse(response)
    return (await response.json()) as T
  }

  async #throwResponse(response: Response): Promise<never> {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined
    const receivedCode = body?.error?.code
    const code = runtimeErrorCodes.includes(
      receivedCode as ConstructorParameters<typeof RuntimeError>[0],
    )
      ? (receivedCode as ConstructorParameters<typeof RuntimeError>[0])
      : 'provider_unavailable'
    throw new RuntimeError(
      code,
      body?.error?.message ?? `runtime request failed with HTTP ${response.status}`,
    )
  }
}
