import { describe, expect, it } from 'vitest'
import {
  parseCommandRequest,
  parseExpectedGeneration,
  parseFileWriteRequest,
  parseSandboxSpec,
} from '../src/index.js'

describe('transport validation', () => {
  it('parses a complete sandbox specification', () => {
    expect(
      parseSandboxSpec({
        clientRequestId: 'complete',
        image: 'public.example/image:latest',
        resources: { cpuMillis: 100, memoryMiB: 128, diskMiB: 256 },
        requiredCapabilities: ['commandExecution'],
        extensions: { 'example.public': true },
      }),
    ).toEqual({
      clientRequestId: 'complete',
      image: 'public.example/image:latest',
      resources: { cpuMillis: 100, memoryMiB: 128, diskMiB: 256 },
      requiredCapabilities: ['commandExecution'],
      extensions: { 'example.public': true },
    })
  })

  it.each([
    null,
    [],
    {},
    { clientRequestId: 1 },
    { clientRequestId: 'x', resources: [] },
    { clientRequestId: 'x', extensions: [] },
    { clientRequestId: 'x', extra: true },
    { clientRequestId: 'x', resources: { memoryMiB: 1, extra: true } },
    { clientRequestId: 'x', requiredCapabilities: ['unknown'] },
  ])('rejects malformed sandbox transport input %#', (value) => {
    expect(() => parseSandboxSpec(value)).toThrowError()
  })

  it('parses a complete command request', () => {
    expect(
      parseCommandRequest({
        expectedGeneration: 2,
        argv: ['printf', 'hello'],
        cwd: '.',
        env: { PROBE: 'ok' },
        timeoutSeconds: 2,
        maxOutputBytes: 10,
      }),
    ).toEqual({
      expectedGeneration: 2,
      argv: ['printf', 'hello'],
      cwd: '.',
      env: { PROBE: 'ok' },
      timeoutSeconds: 2,
      maxOutputBytes: 10,
    })
  })

  it.each([
    undefined,
    {},
    { expectedGeneration: 1, argv: 'printf' },
    { expectedGeneration: 1, argv: [1] },
    { expectedGeneration: 1, argv: [] },
    { expectedGeneration: 1, argv: ['ok'], env: [] },
    { expectedGeneration: 1, argv: ['ok'], env: { PROBE: 1 } },
    { expectedGeneration: 1, argv: ['ok'], timeoutSeconds: -1 },
    { expectedGeneration: 1, argv: ['ok'], maxOutputBytes: 0 },
    { expectedGeneration: 1, argv: ['ok'], extra: true },
  ])('rejects malformed command transport input %#', (value) => {
    expect(() => parseCommandRequest(value)).toThrowError()
  })

  it('parses generation and file write inputs', () => {
    expect(parseExpectedGeneration({ expectedGeneration: 2 })).toBe(2)
    expect(
      parseFileWriteRequest({ expectedGeneration: 2, path: 'a.txt', contentBase64: 'YQ==' }),
    ).toEqual({
      expectedGeneration: 2,
      path: 'a.txt',
      contentBase64: 'YQ==',
    })
  })

  it('rejects malformed generation and file inputs', () => {
    expect(() => parseExpectedGeneration({ expectedGeneration: '2' })).toThrowError()
    expect(() => parseExpectedGeneration({ expectedGeneration: 2, extra: true })).toThrowError()
    expect(() =>
      parseFileWriteRequest({ expectedGeneration: 1, path: 1, contentBase64: true }),
    ).toThrowError()
    expect(() =>
      parseFileWriteRequest({
        expectedGeneration: 1,
        path: 'a',
        contentBase64: 'YQ==',
        extra: true,
      }),
    ).toThrowError()
  })
})
