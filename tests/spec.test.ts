import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  capabilityNames,
  LocalSandboxProvider,
  MockSandboxProvider,
  protocolVersion,
  sandboxEventTypes,
  sandboxStates,
} from '../src/index.js'

describe('OpenAPI projection', () => {
  it('matches the executable protocol vocabularies', async () => {
    const document = parse(await readFile('spec/openapi.yaml', 'utf8'))
    expect(document.openapi).toBe('3.1.0')
    expect(document.info.version).toBe(JSON.parse(await readFile('package.json', 'utf8')).version)
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

  it('documents boundary validation on every HTTP operation', async () => {
    const document = parse(await readFile('spec/openapi.yaml', 'utf8'))
    for (const path of Object.values(document.paths) as Record<
      string,
      { responses?: Record<string, unknown> }
    >[]) {
      for (const [method, operation] of Object.entries(path)) {
        if (['get', 'post', 'put'].includes(method)) {
          expect(operation.responses?.['400']).toEqual({
            $ref: '#/components/responses/InvalidRequest',
          })
        }
      }
    }
  })

  it('aligns package and reference Provider versions while retaining the publication guard', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const provider = new LocalSandboxProvider()
    try {
      for (const implementation of [provider, new MockSandboxProvider()]) {
        expect((await implementation.describe({ requestId: 'version-probe' })).version).toBe(
          pkg.version,
        )
      }
      expect(pkg.private).toBe(true)
    } finally {
      await provider.dispose()
    }
  })
})
