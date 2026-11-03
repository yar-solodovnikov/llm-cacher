export const ENTRY_TYPE_FULL = 'full' as const
export const ENTRY_TYPE_STREAM = 'stream' as const

export interface CacheEntry {
  key: string
  type: typeof ENTRY_TYPE_FULL | typeof ENTRY_TYPE_STREAM
  value: unknown
  chunks?: unknown[]
  createdAt: number
  expiresAt: number | null
  // Semantic index data, persisted so the index can be rebuilt after a restart
  embedding?: number[]
  scope?: string
}

// Corrupted rows are skipped rather than failing a whole scan
export function parseEntry(raw: string): CacheEntry | null {
  try {
    return JSON.parse(raw) as CacheEntry
  } catch {
    return null
  }
}

export function isLiveEntry(entry: CacheEntry, now: number): boolean {
  if (entry.type !== ENTRY_TYPE_FULL && entry.type !== ENTRY_TYPE_STREAM) return false
  return entry.expiresAt === null || now <= entry.expiresAt
}

export interface IStorage {
  get(key: string): Promise<CacheEntry | null>
  set(key: string, entry: CacheEntry): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  // Optional: yields every live entry. Lets CacheManager rebuild the in-memory semantic
  // index from a persistent backend after a restart.
  entries?(): AsyncIterable<CacheEntry>
}
