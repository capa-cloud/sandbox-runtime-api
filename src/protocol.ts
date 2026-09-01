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
] as const

export type CapabilityName = (typeof capabilityNames)[number]

export type RuntimeCapabilities = Readonly<Record<CapabilityName, boolean>>

export type ProviderManifest = Readonly<{
  name: string
  version: string
  runtimeClass: string
  capabilities: RuntimeCapabilities
}>

export type ResourceRequest = Readonly<{
  cpuMillis?: number
  memoryMiB?: number
  diskMiB?: number
}>

export type LifetimePolicy = Readonly<{
  idleTimeoutSeconds?: number
  maxLifetimeSeconds?: number
}>

export type SandboxSpec = Readonly<{
  clientRequestId: string
  image?: string
  template?: string
  resources?: ResourceRequest
  lifetime?: LifetimePolicy
  requiredCapabilities?: readonly CapabilityName[]
  extensions?: Readonly<Record<string, unknown>>
}>

export type SandboxEndpoint = Readonly<{
  baseUrl: string
}>

export type SandboxResource = Readonly<{
  id: string
  generation: number
  state: SandboxState
  spec: SandboxSpec
  provider: string
  endpoint?: SandboxEndpoint
  providerExtensions?: Readonly<Record<string, unknown>>
  failure?: Readonly<{
    code: string
    message: string
  }>
  createdAt: string
  updatedAt: string
}>

export const runtimeErrorCodes = [
  'invalid_request',
  'unsupported_capability',
  'idempotency_conflict',
  'generation_conflict',
  'not_found',
  'invalid_state',
  'provider_unavailable',
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
