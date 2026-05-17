import { describe, it, expect, vi } from 'vitest'
import { CacheManager } from '../src/core/CacheManager'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import type { IEmbedder } from '../src/embeddings/IEmbedder'

// mock embedder: returns predictable vectors based on text
function makeMockEmbedder(map: Record<string, number[]>): IEmbedder {
  return {
    dimensions: 3,
    embed: vi.fn(async (text: string) => {
      return map[text] ?? [0, 0, 0]
    }),
  }
}

describe('CacheManager — semantic cache', () => {
  it('returns exact match without calling embedder', async () => {
    const embedder = makeMockEmbedder({})
    const manager = new CacheManager({
      storage: new MemoryStorage(),
      semantic: { embedder, threshold: 0.9 },
    })

    await manager.set('key1', { type: 'full', value: 'response' }, 'hello')
    vi.clearAllMocks() // reset call count after set
    // get by exact key — should NOT call embedder again
    const result = await manager.get('key1')
    expect(result?.value).toBe('response')
    expect(embedder.embed).not.toHaveBeenCalled()
  })

  it('finds semantically similar entry', async () => {
    const embedder = makeMockEmbedder({
      'user: explain async/await': [1, 0, 0],
      'user: what is async/await?': [0.99, 0.1, 0],
    })
    const manager = new CacheManager({
      storage: new MemoryStorage(),
      semantic: { embedder, threshold: 0.9 },
    })

    await manager.set('key1', { type: 'full', value: 'cached response' }, 'user: explain async/await')

    // different key, similar text
    const result = await manager.get('key2', 'user: what is async/await?')
    expect(result?.value).toBe('cached response')
  })

  it('returns null when similarity is below threshold', async () => {
    const embedder = makeMockEmbedder({
      'user: explain async/await': [1, 0, 0],
      'user: what is the weather?': [0, 1, 0],
    })
    const manager = new CacheManager({
      storage: new MemoryStorage(),
      semantic: { embedder, threshold: 0.9 },
    })

    await manager.set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await')
    const result = await manager.get('key2', 'user: what is the weather?')
    expect(result).toBeNull()
  })

  it('removes stale embedding from similarity index when storage entry expires', async () => {
    const embedder = makeMockEmbedder({
      'user: explain async/await': [1, 0, 0],
      'user: what is async/await?': [0.99, 0.1, 0],
    })
    const manager = new CacheManager({
      storage: new MemoryStorage(),
      semantic: { embedder, threshold: 0.9 },
    })

    // store with immediate expiry
    await manager.set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await')
    // @ts-expect-error — force-expire via private storage
    const entry = (manager as unknown as { storage: MemoryStorage }).storage
    await entry.set('key1', { key: 'key1', type: 'full', value: 'cached', createdAt: 0, expiresAt: 1 })

    // first call: similarity finds key1, storage returns null, embedding removed
    const miss = await manager.get('key2', 'user: what is async/await?')
    expect(miss).toBeNull()

    // @ts-expect-error — verify embedding was removed from index
    expect((manager as unknown as { similarity: { size: number } }).similarity?.size).toBe(0)
  })

  it('cleans up stale similarity entry on exact-match miss so it never shows up in future semantic searches', async () => {
    const embedder = makeMockEmbedder({
      'user: explain async/await': [1, 0, 0],
      'user: what is async/await?': [0.99, 0.1, 0],
    })
    const manager = new CacheManager({
      storage: new MemoryStorage(),
      semantic: { embedder, threshold: 0.9 },
    })

    await manager.set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await')

    // Force-expire the entry by overwriting it with an already-past expiresAt
    const storage = (manager as unknown as { storage: MemoryStorage }).storage
    await storage.set('key1', { key: 'key1', type: 'full', value: 'cached', createdAt: 0, expiresAt: 1 })

    // Exact-match get on the expired key — returns null, and must remove from similarity index
    const exactMiss = await manager.get('key1', 'user: explain async/await')
    expect(exactMiss).toBeNull()
    expect((manager as unknown as { similarity: { size: number } }).similarity?.size).toBe(0)

    // Subsequent semantic search must also return null (not find the ghost entry)
    const semanticMiss = await manager.get('key2', 'user: what is async/await?')
    expect(semanticMiss).toBeNull()
  })

  it('does not use semantic when no text is provided', async () => {
    const embedder = makeMockEmbedder({})
    const manager = new CacheManager({
      storage: new MemoryStorage(),
      semantic: { embedder, threshold: 0.9 },
    })

    await manager.set('key1', { type: 'full', value: 'response' }, 'some text')
    vi.clearAllMocks() // reset call count after set
    const result = await manager.get('key2') // no text — should not call embedder
    expect(result).toBeNull()
    expect(embedder.embed).not.toHaveBeenCalled()
  })
})
