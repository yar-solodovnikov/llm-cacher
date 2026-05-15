import type { IStorage } from '../storage/IStorage'
import type { StorageErrorStrategy, SemanticOptions } from '../core/CacheManager'
import { STORAGE_TYPE_MEMORY, STORAGE_TYPE_FILE, STORAGE_TYPE_SQLITE } from '../constants'

export type StorageType = typeof STORAGE_TYPE_MEMORY | typeof STORAGE_TYPE_FILE | typeof STORAGE_TYPE_SQLITE

export interface LlmCacheOptions {
  ttl?: string | number
  storage?: StorageType | IStorage
  storagePath?: string
  maxSize?: number
  onStorageError?: StorageErrorStrategy
  semantic?: SemanticOptions
}
