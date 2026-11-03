import type { IStorage, CacheEntry } from '../storage/IStorage'
import type { IEmbedder } from '../embeddings/IEmbedder'
import { SimilarityEngine, type IndexType } from './SimilarityEngine'
import { parseTTL } from '../utils/ttl'

export type StorageErrorStrategy = 'passthrough' | 'throw'

export interface SemanticOptions {
  embedder: IEmbedder
  threshold?: number
  indexType?: IndexType
  // Rebuild the in-memory index from the storage on the first semantic lookup (default: true).
  // This reads every stored entry once — a full Scan on DynamoDB.
  restore?: boolean
  // Stop restoring after this many entries. Backends return entries in no particular order.
  restoreLimit?: number
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
  private restorePromise: Promise<void> | null = null
  private readonly restoreEnabled: boolean
  private readonly restoreLimit: number

  constructor(options: CacheManagerOptions) {
    this.storage = options.storage
    this.ttlMs = options.ttl != null ? parseTTL(options.ttl) : null
    this.onStorageError = options.onStorageError ?? 'passthrough'

    const restoreLimit = options.semantic?.restoreLimit
    if (restoreLimit !== undefined && !(Number.isInteger(restoreLimit) && restoreLimit > 0)) {
      throw new Error(`semantic.restoreLimit must be a positive integer, got ${restoreLimit}`)
    }
    this.restoreEnabled = options.semantic?.restore ?? true
    this.restoreLimit = restoreLimit ?? Infinity

    if (options.semantic) {
      this.embedder = options.semantic.embedder
      this.similarity = new SimilarityEngine({
        threshold: options.semantic.threshold ?? DEFAULT_SEMANTIC_THRESHOLD,
        indexType: options.semantic.indexType ?? DEFAULT_INDEX_TYPE,
        dimensions: options.semantic.embedder.dimensions,
      })
    }
  }

  // `scope` limits semantic matches to entries stored with the same scope (see SimilarityEngine)
  async get(key: string, text?: string, scope?: string): Promise<CacheEntry | null> {
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
        await this.restoreIndex()
        const embedding = await this.embedder.embed(text)
        const similarKey = this.similarity.findSimilar(embedding, scope)
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

  // The similarity index lives in memory while persistent backends outlive the process —
  // rebuild it once from the embeddings stored with each entry, before the first semantic lookup.
  private restoreIndex(): Promise<void> {
    const { similarity, embedder, storage } = this
    if (!this.restoreEnabled || !similarity || !embedder || !storage.entries) return Promise.resolve()
    this.restorePromise ??= (async () => {
      let restored = 0
      for await (const entry of storage.entries!()) {
        // vectors from a different embedder can't be compared with the current one
        if (entry.embedding?.length !== embedder.dimensions) continue
        similarity.add(entry.key, entry.embedding, entry.scope)
        // leaving the loop ends the iterator, so remaining pages are never fetched
        if (++restored >= this.restoreLimit) break
      }
    })().catch((err: unknown) => {
      this.restorePromise = null // retry on the next lookup
      throw err
    })
    return this.restorePromise
  }

  async set(key: string, data: Pick<CacheEntry, 'type' | 'value' | 'chunks'>, text?: string, scope?: string): Promise<void> {
    try {
      // Embed first so the vector is persisted with the entry; an embedder failure must
      // still leave the response cached for exact matches.
      let embedding: number[] | undefined
      let embedError: unknown
      if (text && this.embedder && this.similarity) {
        try {
          embedding = await this.embedder.embed(text)
        } catch (err) {
          embedError = err
        }
      }

      const now = Date.now()
      await this.storage.set(key, {
        key,
        ...data,
        createdAt: now,
        expiresAt: this.ttlMs != null ? now + this.ttlMs : null,
        ...(embedding ? { embedding, scope } : {}),
      })

      if (embedding) this.similarity?.add(key, embedding, scope)
      if (embedError) throw embedError
    } catch (err) {
      if (this.onStorageError === 'passthrough') return
      throw err
    }
  }
}
