import type { SandboxProvider } from './provider.js'

export type ConformanceResult = Readonly<{
  name: string
  passed: boolean
  detail?: string
}>

export const runProviderConformance = async (
  provider: SandboxProvider,
): Promise<readonly ConformanceResult[]> => {
  const context = { requestId: 'conformance' }
  const manifest = await provider.describe(context)
  const key = { sandboxId: 'conformance-sandbox', generation: 1 }
  const results: ConformanceResult[] = []

  const provisioned = await provider.provision(
    {
      ...key,
      spec: { clientRequestId: 'conformance-create', image: 'public.example/sandbox:latest' },
    },
    context,
  )
  results.push({
    name: 'provision returns an observable non-terminal state',
    passed: !['failed', 'terminated'].includes(provisioned.state),
    ...(provisioned.state === 'failed' || provisioned.state === 'terminated'
      ? { detail: `observed ${provisioned.state}` }
      : {}),
  })

  const observed = await provider.observe(key, context)
  results.push({
    name: 'observe preserves the provider resource identity',
    passed: observed.state === provisioned.state,
    ...(observed.state !== provisioned.state
      ? { detail: `provision=${provisioned.state} observe=${observed.state}` }
      : {}),
  })

  if (manifest.capabilities.pauseResume) {
    if (!provider.pause || !provider.resume) {
      results.push({
        name: 'pauseResume capability has SPI methods',
        passed: false,
        detail: 'manifest declares pauseResume without pause and resume methods',
      })
    } else {
      const paused = await provider.pause(key, context)
      const resumed = await provider.resume(key, context)
      results.push({ name: 'pause reaches paused', passed: paused.state === 'paused' })
      results.push({ name: 'resume leaves paused', passed: resumed.state !== 'paused' })
    }
  }

  const terminated = await provider.terminate(key, context)
  results.push({ name: 'terminate reaches terminated', passed: terminated.state === 'terminated' })

  return results
}
