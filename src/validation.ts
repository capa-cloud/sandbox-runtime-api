import {
  capabilityNames,
  type CapabilityName,
  type CommandRequest,
  type FileWriteRequest,
  type JsonObject,
  type JsonValue,
  RuntimeError,
  type SandboxSpec,
} from './protocol.js'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isJsonValue = (value: unknown, seen = new WeakSet<object>()): value is JsonValue => {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : isRecord(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
      Object.values(value).every((entry) => isJsonValue(entry, seen))
  seen.delete(value)
  return valid
}

const assertKeys = (record: Record<string, unknown>, allowed: readonly string[]): void => {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new RuntimeError(
      'invalid_request',
      `unknown request fields: ${unknown.sort().join(', ')}`,
    )
  }
}

const optionalString = (record: Record<string, unknown>, name: string): string | undefined => {
  const value = record[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string')
    throw new RuntimeError('invalid_request', `${name} must be a string`)
  return value
}

const optionalNumber = (record: Record<string, unknown>, name: string): number | undefined => {
  const value = record[name]
  if (value === undefined) return undefined
  if (typeof value !== 'number')
    throw new RuntimeError('invalid_request', `${name} must be a number`)
  return value
}

export const parseSandboxSpec = (value: unknown): SandboxSpec => {
  if (!isRecord(value)) throw new RuntimeError('invalid_request', 'request body must be an object')
  assertKeys(value, [
    'clientRequestId',
    'image',
    'template',
    'resources',
    'requiredCapabilities',
    'extensions',
  ])
  const clientRequestId = value.clientRequestId
  if (typeof clientRequestId !== 'string') {
    throw new RuntimeError('invalid_request', 'clientRequestId must be a string')
  }
  const requiredCapabilitiesValue = value.requiredCapabilities
  let requiredCapabilities: CapabilityName[] | undefined
  if (requiredCapabilitiesValue !== undefined) {
    if (
      !Array.isArray(requiredCapabilitiesValue) ||
      requiredCapabilitiesValue.some(
        (entry) => typeof entry !== 'string' || !capabilityNames.includes(entry as CapabilityName),
      )
    ) {
      throw new RuntimeError(
        'invalid_request',
        'requiredCapabilities contains an unknown capability',
      )
    }
    requiredCapabilities = [...requiredCapabilitiesValue] as CapabilityName[]
  }
  const resourcesValue = value.resources
  if (resourcesValue !== undefined && !isRecord(resourcesValue)) {
    throw new RuntimeError('invalid_request', 'resources must be an object')
  }
  if (resourcesValue) assertKeys(resourcesValue, ['cpuMillis', 'memoryMiB', 'diskMiB'])
  if (
    value.extensions !== undefined &&
    (!isRecord(value.extensions) || !isJsonValue(value.extensions))
  ) {
    throw new RuntimeError('invalid_request', 'extensions must be a JSON object')
  }

  const image = optionalString(value, 'image')
  const template = optionalString(value, 'template')
  const cpuMillis = resourcesValue ? optionalNumber(resourcesValue, 'cpuMillis') : undefined
  const memoryMiB = resourcesValue ? optionalNumber(resourcesValue, 'memoryMiB') : undefined
  const diskMiB = resourcesValue ? optionalNumber(resourcesValue, 'diskMiB') : undefined

  return {
    clientRequestId,
    ...(image !== undefined ? { image } : {}),
    ...(template !== undefined ? { template } : {}),
    ...(resourcesValue
      ? {
          resources: {
            ...(cpuMillis !== undefined ? { cpuMillis } : {}),
            ...(memoryMiB !== undefined ? { memoryMiB } : {}),
            ...(diskMiB !== undefined ? { diskMiB } : {}),
          },
        }
      : {}),
    ...(requiredCapabilities ? { requiredCapabilities } : {}),
    ...(value.extensions ? { extensions: value.extensions as JsonObject } : {}),
  }
}

export const parseCommandRequest = (value: unknown): CommandRequest => {
  if (!isRecord(value)) throw new RuntimeError('invalid_request', 'request body must be an object')
  assertKeys(value, [
    'expectedGeneration',
    'argv',
    'cwd',
    'env',
    'timeoutSeconds',
    'maxOutputBytes',
  ])
  const expectedGeneration = parseExpectedGeneration({
    expectedGeneration: value.expectedGeneration,
  })
  if (
    !Array.isArray(value.argv) ||
    value.argv.length === 0 ||
    value.argv.some((entry) => typeof entry !== 'string' || entry.includes('\0'))
  ) {
    throw new RuntimeError('invalid_request', 'argv must contain at least one valid string')
  }
  if (value.env !== undefined && !isRecord(value.env)) {
    throw new RuntimeError('invalid_request', 'env must be an object')
  }
  const env = value.env
    ? Object.fromEntries(
        Object.entries(value.env).map(([name, entry]) => {
          if (typeof entry !== 'string') {
            throw new RuntimeError('invalid_request', `environment value ${name} must be a string`)
          }
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || entry.includes('\0')) {
            throw new RuntimeError('invalid_request', `invalid environment entry ${name}`)
          }
          return [name, entry]
        }),
      )
    : undefined
  const cwd = optionalString(value, 'cwd')
  const timeoutSeconds = optionalNumber(value, 'timeoutSeconds')
  const maxOutputBytes = optionalNumber(value, 'maxOutputBytes')
  if (
    timeoutSeconds !== undefined &&
    (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 3600)
  ) {
    throw new RuntimeError('invalid_request', 'timeoutSeconds must be in (0, 3600]')
  }
  if (
    maxOutputBytes !== undefined &&
    (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 10 * 1024 * 1024)
  ) {
    throw new RuntimeError('invalid_request', 'maxOutputBytes must be in [1, 10485760]')
  }
  return {
    expectedGeneration,
    argv: value.argv as string[],
    ...(cwd !== undefined ? { cwd } : {}),
    ...(env ? { env } : {}),
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
  }
}

export const parseExpectedGeneration = (value: unknown): number => {
  if (!isRecord(value) || typeof value.expectedGeneration !== 'number') {
    throw new RuntimeError('invalid_request', 'expectedGeneration must be a number')
  }
  assertKeys(value, ['expectedGeneration'])
  if (!Number.isInteger(value.expectedGeneration) || value.expectedGeneration < 1) {
    throw new RuntimeError('invalid_request', 'expectedGeneration must be a positive integer')
  }
  return value.expectedGeneration
}

export const parseFileWriteRequest = (value: unknown): FileWriteRequest => {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    typeof value.contentBase64 !== 'string' ||
    typeof value.expectedGeneration !== 'number'
  ) {
    throw new RuntimeError(
      'invalid_request',
      'expectedGeneration must be a number and path/contentBase64 must be strings',
    )
  }
  assertKeys(value, ['expectedGeneration', 'path', 'contentBase64'])
  return {
    expectedGeneration: parseExpectedGeneration({
      expectedGeneration: value.expectedGeneration,
    }),
    path: value.path,
    contentBase64: value.contentBase64,
  }
}
