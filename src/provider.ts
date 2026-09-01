import type { ProviderManifest, SandboxEndpoint, SandboxSpec, SandboxState } from './protocol.js'

export type ProviderContext = Readonly<{
  requestId: string
  signal?: AbortSignal
}>

export type ProviderSandboxKey = Readonly<{
  sandboxId: string
  generation: number
}>

export type ProviderObservation = Readonly<{
  state: SandboxState
  endpoint?: SandboxEndpoint
  extensions?: Readonly<Record<string, unknown>>
  failure?: Readonly<{
    code: string
    message: string
  }>
}>

export type ProviderProvisionRequest = ProviderSandboxKey &
  Readonly<{
    spec: SandboxSpec
  }>

export interface SandboxProvider {
  describe(context: ProviderContext): Promise<ProviderManifest>
  provision(
    request: ProviderProvisionRequest,
    context: ProviderContext,
  ): Promise<ProviderObservation>
  observe(key: ProviderSandboxKey, context: ProviderContext): Promise<ProviderObservation>
  terminate(key: ProviderSandboxKey, context: ProviderContext): Promise<ProviderObservation>
  pause?(key: ProviderSandboxKey, context: ProviderContext): Promise<ProviderObservation>
  resume?(key: ProviderSandboxKey, context: ProviderContext): Promise<ProviderObservation>
}
