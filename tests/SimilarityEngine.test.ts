import { describe, it, expect } from 'vitest'
import { SimilarityEngine } from '../src/core/SimilarityEngine'

// simple 3-dim embeddings for testing
const vecA = [1, 0, 0]
const vecB = [0.99, 0.1, 0.05] // very similar to A
const vecC = [0, 1, 0]         // orthogonal to A

describe('SimilarityEngine — flat', () => {
  it('finds similar vector above threshold', () => {
    const engine = new SimilarityEngine({ threshold: 0.9 })
    engine.add('key-a', vecA)
    expect(engine.findSimilar(vecB)).toBe('key-a')
  })

  it('returns null when no vector exceeds threshold', () => {
    const engine = new SimilarityEngine({ threshold: 0.9 })
    engine.add('key-a', vecA)
    expect(engine.findSimilar(vecC)).toBeNull()
  })

  it('returns null when index is empty', () => {
    const engine = new SimilarityEngine({ threshold: 0.9 })
    expect(engine.findSimilar(vecA)).toBeNull()
  })

  it('removes an entry', () => {
    const engine = new SimilarityEngine({ threshold: 0.9 })
    engine.add('key-a', vecA)
    engine.remove('key-a')
    expect(engine.findSimilar(vecB)).toBeNull()
  })

  it('remove non-existent key is a no-op (does not throw)', () => {
    const engine = new SimilarityEngine({ threshold: 0.9 })
    expect(() => engine.remove('no-such-key')).not.toThrow()
    expect(engine.size).toBe(0)
  })

  it('tracks size correctly', () => {
    const engine = new SimilarityEngine({ threshold: 0.9 })
    expect(engine.size).toBe(0)
    engine.add('a', vecA)
    engine.add('b', vecC)
    expect(engine.size).toBe(2)
    engine.remove('a')
    expect(engine.size).toBe(1)
  })

  it('returns best match among multiple entries', () => {
    const engine = new SimilarityEngine({ threshold: 0.5 })
    engine.add('key-a', vecA)
    engine.add('key-c', vecC)
    // vecB is closer to vecA
    expect(engine.findSimilar(vecB)).toBe('key-a')
  })

  it('re-adding the same key updates the embedding without growing the index', () => {
    const engine = new SimilarityEngine({ threshold: 0.9 })
    engine.add('key-a', vecA)
    engine.add('key-a', vecC) // overwrite with orthogonal vector
    expect(engine.size).toBe(1)
    // Now the stored vector is vecC — vecA should NOT match anymore
    expect(engine.findSimilar(vecA)).toBeNull()
    // Remove must fully clean up — size becomes 0
    engine.remove('key-a')
    expect(engine.size).toBe(0)
    expect(engine.findSimilar(vecC)).toBeNull()
  })
})

describe('SimilarityEngine — hnsw duplicate key', () => {
  it('re-adding the same key via HNSW does not leave a dangling labelToKey entry', () => {
    const engine = new SimilarityEngine({ threshold: 0.9, indexType: 'hnsw', dimensions: 3 })
    engine.add('key-a', vecA)
    engine.add('key-a', vecC) // overwrite — old label must be evicted first
    expect(engine.size).toBe(1)
    // The stored vector is now vecC — a query close to vecA should not match
    expect(engine.findSimilar(vecA)).toBeNull()
    // Full removal: size drops to 0 and further searches return null
    engine.remove('key-a')
    expect(engine.size).toBe(0)
    expect(engine.findSimilar(vecC)).toBeNull()
  })

  it('HNSW remove non-existent key is a no-op (does not throw)', () => {
    const engine = new SimilarityEngine({ threshold: 0.9, indexType: 'hnsw', dimensions: 3 })
    expect(() => engine.remove('no-such-key')).not.toThrow()
    expect(engine.size).toBe(0)
  })
})

describe('SimilarityEngine — hnsw capacity', () => {
  it('grows the index instead of throwing when maxElements is reached', () => {
    const engine = new SimilarityEngine({ threshold: 0.9, indexType: 'hnsw', dimensions: 3, maxElements: 2 })
    engine.add('key-a', [1, 0, 0])
    engine.add('key-b', [0, 1, 0])
    expect(() => engine.add('key-c', [0, 0, 1])).not.toThrow()
    expect(engine.size).toBe(3)
    expect(engine.findSimilar([0, 0.05, 1])).toBe('key-c')
    expect(engine.findSimilar([1, 0.05, 0])).toBe('key-a')
  })

  it('reuses deleted slots before growing', () => {
    const engine = new SimilarityEngine({ threshold: 0.9, indexType: 'hnsw', dimensions: 3, maxElements: 2 })
    engine.add('key-a', [1, 0, 0])
    engine.add('key-b', [0, 1, 0])
    engine.remove('key-a')
    engine.add('key-c', [0, 0, 1])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((engine as any).hnswIndex.getMaxElements()).toBe(2)
    expect(engine.findSimilar([0, 0.05, 1])).toBe('key-c')
  })
})

describe.each(['flat', 'hnsw'] as const)('SimilarityEngine — scopes (%s)', (indexType) => {
  const make = () => new SimilarityEngine({ threshold: 0.9, indexType, dimensions: 3 })

  it('matches an entry from the same scope', () => {
    const engine = make()
    engine.add('key-a', vecA, 'gpt-4o')
    expect(engine.findSimilar(vecB, 'gpt-4o')).toBe('key-a')
  })

  it('does not match an entry from another scope', () => {
    const engine = make()
    engine.add('key-a', vecA, 'gpt-4o-mini')
    expect(engine.findSimilar(vecB, 'gpt-4o')).toBeNull()
  })

  it('does not match scoped entries from an unscoped query', () => {
    const engine = make()
    engine.add('key-a', vecA, 'gpt-4o')
    expect(engine.findSimilar(vecB)).toBeNull()
  })

  it('picks the closest entry within the scope even when a closer one exists elsewhere', () => {
    const engine = make()
    engine.add('other-scope', vecB, 'gpt-4o-mini')
    engine.add('same-scope', [0.95, 0.2, 0.1], 'gpt-4o')
    expect(engine.findSimilar(vecB, 'gpt-4o')).toBe('same-scope')
  })

  it('moves a re-added key to its new scope', () => {
    const engine = make()
    engine.add('key-a', vecA, 'old')
    engine.add('key-a', vecA, 'new')
    expect(engine.findSimilar(vecB, 'old')).toBeNull()
    expect(engine.findSimilar(vecB, 'new')).toBe('key-a')
    expect(engine.size).toBe(1)
  })

  it('forgets the scope of a removed key', () => {
    const engine = make()
    engine.add('key-a', vecA, 'gpt-4o')
    engine.remove('key-a')
    expect(engine.findSimilar(vecB, 'gpt-4o')).toBeNull()
  })
})
