export const sandboxStates = [
  'requested',
  'starting',
  'ready',
  'pausing',
  'paused',
  'resuming',
  'terminating',
  'terminated',
  'failed',
] as const

export type SandboxState = (typeof sandboxStates)[number]

export const protocolVersion = '0.1'

export const capabilityNames = [
  'commandExecution',
  'fileAccess',
  'interactiveTerminal',
  'portForwarding',
  'pauseResume',
  'filesystemSnapshot',
  'memorySnapshot',
  'persistentVolume',
  'networkPolicy',
  'imageReference',
  'templateReference',
  'resourceLimits',
] as const

export type CapabilityName = (typeof capabilityNames)[number]

export type RuntimeCapabilities = Readonly<Record<CapabilityName, boolean>>

export type ProviderManifest = Readonly<{
  name: string
  version: string
  runtimeClass: string
  capabilities: RuntimeCapabilities
}>

export type RuntimeInfo = Readonly<{
  protocolVersion: string
  provider: ProviderManifest
}>

export type ResourceRequest = Readonly<{
  cpuMillis?: number
  memoryMiB?: number
  diskMiB?: number
}>

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject

export type JsonObject = Readonly<{ [key: string]: JsonValue }>

export type SandboxSpec = Readonly<{
  clientRequestId: string
  image?: string
  template?: string
  resources?: ResourceRequest
  requiredCapabilities?: readonly CapabilityName[]
  extensions?: JsonObject
}>

export type SandboxEndpoint = Readonly<{
  baseUrl: string
}>

export type CommandRequest = Readonly<{
  expectedGeneration: number
  argv: readonly string[]
  cwd?: string
  env?: Readonly<Record<string, string>>
  timeoutSeconds?: number
  maxOutputBytes?: number
}>

export type CommandResult = Readonly<{
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled: boolean
  truncated: boolean
  startedAt: string
  finishedAt: string
}>

export type FileWriteRequest = Readonly<{
  expectedGeneration: number
  path: string
  contentBase64: string
}>

export type FileReadResult = Readonly<{
  path: string
  contentBase64: string
  size: number
}>

export type FileEntry = Readonly<{
  path: string
  kind: 'file' | 'directory'
  size: number
}>

export type SandboxResource = Readonly<{
  id: string
  generation: number
  state: SandboxState
  spec: SandboxSpec
  provider: string
  endpoint?: SandboxEndpoint
  providerExtensions?: JsonObject
  failure?: Readonly<{
    code: string
    message: string
  }>
  createdAt: string
  updatedAt: string
}>

export const sandboxEventTypes = [
  'sandbox.created',
  'sandbox.state_changed',
  'sandbox.command_completed',
  'sandbox.file_written',
] as const

export type SandboxEventType = (typeof sandboxEventTypes)[number]

export type SandboxEvent = Readonly<{
  cursor: number
  type: SandboxEventType
  sandboxId: string
  generation: number
  timestamp: string
  data: JsonObject
}>

export const runtimeErrorCodes = [
  'invalid_request',
  'unsupported_capability',
  'idempotency_conflict',
  'generation_conflict',
  'not_found',
  'invalid_state',
  'provider_unavailable',
  'provider_protocol_error',
  'event_history_unavailable',
] as const

export type RuntimeErrorCode = (typeof runtimeErrorCodes)[number]

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode

  constructor(code: RuntimeErrorCode, message: string) {
    super(message)
    this.name = 'RuntimeError'
    this.code = code
  }
}
