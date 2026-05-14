import type { IStorage } from '../storage/IStorage'
import type { StorageErrorStrategy } from '../core/CacheManager'

export interface LlmCacheOptions {
  ttl?: string | number
  storage?: 'memory' | IStorage
  maxSize?: number
  onStorageError?: StorageErrorStrategy
}
