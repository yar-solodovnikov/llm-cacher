export interface CacheEntry {
  key: string
  type: 'full' | 'stream'
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
