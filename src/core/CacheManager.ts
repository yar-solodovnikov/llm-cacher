import type { IStorage, CacheEntry } from '../storage/IStorage'
import type { IEmbedder } from '../embeddings/IEmbedder'
import { SimilarityEngine, type IndexType } from './SimilarityEngine'
import { parseTTL } from '../utils/ttl'

export type StorageErrorStrategy = 'passthrough' | 'throw'

export interface SemanticOptions {
  embedder: IEmbedder
  threshold?: number
  indexType?: IndexType
}

export interface CacheManagerOptions {
  storage: IStorage
  ttl?: string | number
  onStorageError?: StorageErrorStrategy
  semantic?: SemanticOptions
}

const DEFAULT_SEMANTIC_THRESHOLD = 0.92
const DEFAULT_INDEX_TYPE: IndexType = 'flat'

export class CacheManager {
  private storage: IStorage
  private ttlMs: number | null
  private onStorageError: StorageErrorStrategy
  private similarity: SimilarityEngine | null = null
  private embedder: IEmbedder | null = null

  constructor(options: CacheManagerOptions) {
    this.storage = options.storage
    this.ttlMs = options.ttl != null ? parseTTL(options.ttl) : null
    this.onStorageError = options.onStorageError ?? 'passthrough'

    if (options.semantic) {
      this.embedder = options.semantic.embedder
      this.similarity = new SimilarityEngine({
        threshold: options.semantic.threshold ?? DEFAULT_SEMANTIC_THRESHOLD,
        indexType: options.semantic.indexType ?? DEFAULT_INDEX_TYPE,
        dimensions: options.semantic.embedder.dimensions,
      })
    }
  }

  async get(key: string, text?: string): Promise<CacheEntry | null> {
    try {
      // 1. exact match
      const exact = await this.storage.get(key)
      if (exact) return exact

      // If storage returned null for a key that was semantically indexed, the entry
      // expired — remove it from the similarity index now rather than waiting for a
      // future semantic search to stumble upon it (prevents unbounded index growth).
      if (this.similarity) this.similarity.remove(key)

      // 2. semantic match
      if (text && this.embedder && this.similarity) {
        const embedding = await this.embedder.embed(text)
        const similarKey = this.similarity.findSimilar(embedding)
        if (similarKey) {
          const result = await this.storage.get(similarKey)
          // storage returned null → entry expired; remove stale embedding from index
          if (!result) this.similarity.remove(similarKey)
          return result
        }
      }

      return null
    } catch (err) {
      if (this.onStorageError === 'passthrough') return null
      throw err
    }
  }

  async set(key: string, data: Pick<CacheEntry, 'type' | 'value' | 'chunks'>, text?: string): Promise<void> {
    try {
      const now = Date.now()
      await this.storage.set(key, {
        key,
        ...data,
        createdAt: now,
        expiresAt: this.ttlMs != null ? now + this.ttlMs : null,
      })

      if (text && this.embedder && this.similarity) {
        const embedding = await this.embedder.embed(text)
        this.similarity.add(key, embedding)
      }
    } catch (err) {
      if (this.onStorageError === 'passthrough') return
      throw err
    }
  }
}
