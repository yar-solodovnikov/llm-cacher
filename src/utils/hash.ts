import { createHash } from 'crypto'

const HASH_ALGORITHM = 'sha256'
const HASH_DIGEST = 'hex'

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map(k => [k, sortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

export function hashObject(obj: unknown): string {
  const normalized = JSON.stringify(sortKeys(obj))
  return createHash(HASH_ALGORITHM).update(normalized).digest(HASH_DIGEST)
}
