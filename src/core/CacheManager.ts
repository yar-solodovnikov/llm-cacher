import type { IStorage, CacheEntry } from '../storage/IStorage'
import { parseTTL } from '../utils/ttl'

export type StorageErrorStrategy = 'passthrough' | 'throw'

export interface CacheManagerOptions {
  storage: IStorage
  ttl?: string | number
  onStorageError?: StorageErrorStrategy
}

export class CacheManager {
  private storage: IStorage
  private ttlMs: number | null
  private onStorageError: StorageErrorStrategy

  constructor(options: CacheManagerOptions) {
    this.storage = options.storage
    this.ttlMs = options.ttl != null ? parseTTL(options.ttl) : null
    this.onStorageError = options.onStorageError ?? 'passthrough'
  }

  async get(key: string): Promise<CacheEntry | null> {
    try {
      return await this.storage.get(key)
    } catch (err) {
      if (this.onStorageError === 'passthrough') return null
      throw err
    }
  }

  async set(key: string, data: Pick<CacheEntry, 'type' | 'value' | 'chunks'>): Promise<void> {
    try {
      const now = Date.now()
      await this.storage.set(key, {
        key,
        ...data,
        createdAt: now,
        expiresAt: this.ttlMs != null ? now + this.ttlMs : null,
      })
    } catch (err) {
      if (this.onStorageError === 'passthrough') return
      throw err
    }
  }
}
