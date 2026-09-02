import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { capabilityNames, protocolVersion, sandboxEventTypes, sandboxStates } from '../src/index.js'

describe('OpenAPI projection', () => {
  it('matches the executable protocol vocabularies', async () => {
    const document = parse(await readFile('spec/openapi.yaml', 'utf8'))
    expect(document.openapi).toBe('3.1.0')
    expect(document.info.version).toBe('0.1.0')
    expect(document.components.schemas.RuntimeInfo.properties.protocolVersion.const).toBe(
      protocolVersion,
    )
    expect(document.components.schemas.CapabilityName.enum).toEqual([...capabilityNames])
    expect(document.components.schemas.RuntimeCapabilities.required).toEqual([...capabilityNames])
    expect(document.components.schemas.SandboxState.enum).toEqual([...sandboxStates])
    expect(document.components.schemas.SandboxEvent.properties.type.enum).toEqual([
      ...sandboxEventTypes,
    ])
    expect(document.components.schemas.CommandRequest.required).toContain('expectedGeneration')
    expect(document.components.schemas.FileWriteRequest.required).toContain('expectedGeneration')
    expect(document.components.schemas.FileReadResult.required).not.toContain('expectedGeneration')
    expect(
      document.components.requestBodies.ExpectedGeneration.content['application/json'].schema
        .additionalProperties,
    ).toBe(false)
    expect(document.components.responses.ProviderProtocolError).toBeDefined()
    expect(document.paths['/v1/runtime'].get.responses).toMatchObject({
      '502': { $ref: '#/components/responses/ProviderProtocolError' },
      '503': { $ref: '#/components/responses/ProviderUnavailable' },
    })
  })

  it('documents every public reference-server route', async () => {
    const document = parse(await readFile('spec/openapi.yaml', 'utf8'))
    expect(Object.keys(document.paths).sort()).toEqual(
      [
        '/healthz',
        '/v1/events',
        '/v1/events/stream',
        '/v1/runtime',
        '/v1/sandboxes',
        '/v1/sandboxes/{sandboxId}',
        '/v1/sandboxes/{sandboxId}/actions/pause',
        '/v1/sandboxes/{sandboxId}/actions/reconcile',
        '/v1/sandboxes/{sandboxId}/actions/recreate',
        '/v1/sandboxes/{sandboxId}/actions/resume',
        '/v1/sandboxes/{sandboxId}/actions/terminate',
        '/v1/sandboxes/{sandboxId}/commands',
        '/v1/sandboxes/{sandboxId}/files/content',
        '/v1/sandboxes/{sandboxId}/files/entries',
      ].sort(),
    )
  })
})
