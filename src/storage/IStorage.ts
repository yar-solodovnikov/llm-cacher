export const ENTRY_TYPE_FULL = 'full' as const
export const ENTRY_TYPE_STREAM = 'stream' as const

export interface CacheEntry {
  key: string
  type: typeof ENTRY_TYPE_FULL | typeof ENTRY_TYPE_STREAM
  value: unknown
  chunks?: unknown[]
  createdAt: number
  expiresAt: number | null
}

export interface IStorage {
  get(key: string): Promise<CacheEntry | null>
  set(key: string, entry: CacheEntry): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
