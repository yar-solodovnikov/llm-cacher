export type IndexType = 'flat' | 'hnsw'

const DEFAULT_DIMENSIONS = 384
const DEFAULT_MAX_ELEMENTS = 100_000
const HNSW_TOP_K = 1
const HNSW_SPACE = 'cosine'

export interface SimilarityEngineOptions {
  threshold: number
  indexType?: IndexType
  dimensions?: number
  maxElements?: number
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export class SimilarityEngine {
  private readonly threshold: number
  private readonly indexType: IndexType

  // flat index
  private flatEntries = new Map<string, number[]>()

  // HNSW index (lazy-init on first add)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hnswIndex: any = null
  private readonly dimensions: number
  private readonly maxElements: number
  private labelToKey = new Map<number, string>()
  private keyToLabel = new Map<string, number>()
  private nextLabel = 0

  constructor(opts: SimilarityEngineOptions) {
    this.threshold = opts.threshold
    this.indexType = opts.indexType ?? 'flat'
    this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS
    this.maxElements = opts.maxElements ?? DEFAULT_MAX_ELEMENTS
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getHnsw(): any {
    if (this.hnswIndex) return this.hnswIndex
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HierarchicalNSW } = require('hnswlib-node') as typeof import('hnswlib-node')
    this.hnswIndex = new HierarchicalNSW(HNSW_SPACE, this.dimensions)
    this.hnswIndex.initIndex(this.maxElements)
    return this.hnswIndex
  }

  add(key: string, embedding: number[]): void {
    if (this.indexType === 'hnsw') {
      const label = this.nextLabel++
      this.getHnsw().addPoint(embedding, label)
      this.labelToKey.set(label, key)
      this.keyToLabel.set(key, label)
    } else {
      this.flatEntries.set(key, embedding)
    }
  }

  remove(key: string): void {
    if (this.indexType === 'hnsw') {
      const label = this.keyToLabel.get(key)
      if (label !== undefined) {
        this.getHnsw().markDelete(label)
        this.keyToLabel.delete(key)
        this.labelToKey.delete(label)
      }
    } else {
      this.flatEntries.delete(key)
    }
  }

  findSimilar(queryEmbedding: number[]): string | null {
    if (this.indexType === 'hnsw') {
      return this.findHnsw(queryEmbedding)
    }
    return this.findFlat(queryEmbedding)
  }

  private findFlat(queryEmbedding: number[]): string | null {
    let bestKey: string | null = null
    let bestScore = -Infinity

    for (const [key, embedding] of this.flatEntries) {
      const score = cosineSimilarity(queryEmbedding, embedding)
      if (score > bestScore) {
        bestScore = score
        bestKey = key
      }
    }

    return bestScore >= this.threshold ? bestKey : null
  }

  private findHnsw(queryEmbedding: number[]): string | null {
    if (this.keyToLabel.size === 0) return null
    const result = this.getHnsw().searchKnn(queryEmbedding, HNSW_TOP_K)
    if (!result.neighbors.length) return null
    const label = result.neighbors[0]
    // HNSW cosine distance = 1 - similarity
    const similarity = 1 - result.distances[0]
    if (similarity < this.threshold) return null
    return this.labelToKey.get(label) ?? null
  }

  get size(): number {
    return this.indexType === 'hnsw' ? this.keyToLabel.size : this.flatEntries.size
  }
}
