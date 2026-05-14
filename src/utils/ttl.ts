const TTL_PATTERN = /^(\d+)(ms|s|m|h|d)$/

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

export function parseTTL(ttl: string | number): number {
  if (typeof ttl === 'number') return ttl
  const match = ttl.match(TTL_PATTERN)
  if (!match) throw new Error(`Invalid TTL format: "${ttl}". Expected e.g. "24h", "30m", "7d"`)
  return parseInt(match[1], 10) * UNITS[match[2]]
}
