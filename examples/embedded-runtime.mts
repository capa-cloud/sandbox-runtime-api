import { InMemorySandboxRuntime, MockSandboxProvider } from 'sandbox-runtime-api'

// The Mock Provider executes no host code. This example needs no credentials.
const runtime = new InMemorySandboxRuntime(new MockSandboxProvider())
const context = { requestId: 'embedded-example' }
const resource = await runtime.create({ clientRequestId: 'example-create' }, context)
const result = await runtime.execute(
  resource.id,
  {
    expectedGeneration: resource.generation,
    argv: ['synthetic-probe'],
  },
  context,
)
await runtime.terminate(resource.id, resource.generation, context)
if (result.exitCode !== 0 || runtime.get(resource.id).state !== 'terminated') {
  throw new Error('embedded example failed')
}
console.log('embedded package example passed')
