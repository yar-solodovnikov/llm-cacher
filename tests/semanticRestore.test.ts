import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { CacheManager } from '../src/core/CacheManager'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import { SQLiteStorage } from '../src/storage/SQLiteStorage'
import type { IEmbedder } from '../src/embeddings/IEmbedder'
import type { IStorage } from '../src/storage/IStorage'

const VECTORS: Record<string, number[]> = {
  'user: explain async/await': [1, 0, 0],
  'user: what is async/await?': [0.99, 0.1, 0.05],
}

function makeEmbedder(dimensions = 3): IEmbedder {
  return { dimensions, embed: vi.fn(async (text: string) => VECTORS[text] ?? [0, 1, 0]) }
}

// A new CacheManager over the same storage = the process restarted with a persistent backend
function restart(storage: IStorage, embedder: IEmbedder = makeEmbedder()) {
  return new CacheManager({ storage, semantic: { embedder, threshold: 0.9 } })
}

describe('CacheManager — semantic index survives a restart', () => {
  it('finds a paraphrase stored by a previous process', async () => {
    const storage = new SQLiteStorage({ db: new Database(':memory:') })
    await restart(storage).set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await', 'scope-a')

    const result = await restart(storage).get('key2', 'user: what is async/await?', 'scope-a')
    expect(result?.value).toBe('cached')
  })

  it('keeps the scope of restored entries', async () => {
    const storage = new SQLiteStorage({ db: new Database(':memory:') })
    await restart(storage).set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await', 'gpt-4o-mini')

    expect(await restart(storage).get('key2', 'user: what is async/await?', 'gpt-4o')).toBeNull()
  })

  it('persists the embedding and scope with the entry', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    await restart(storage).set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await', 'scope-a')
    const entry = await storage.get('key1')
    expect(entry?.embedding).toEqual([1, 0, 0])
    expect(entry?.scope).toBe('scope-a')
    storage.destroy()
  })

  it('does not store an embedding when semantic caching is off', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    await new CacheManager({ storage }).set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await')
    expect((await storage.get('key1'))?.embedding).toBeUndefined()
    storage.destroy()
  })

  it('ignores stored vectors from an embedder with different dimensions', async () => {
    const storage = new SQLiteStorage({ db: new Database(':memory:') })
    await restart(storage).set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await')

    const embedder4d: IEmbedder = { dimensions: 4, embed: vi.fn(async () => [0.99, 0.1, 0.05, 0]) }
    expect(await restart(storage, embedder4d).get('key2', 'user: what is async/await?')).toBeNull()
  })

  it('reads the storage only once', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const entries = vi.spyOn(storage, 'entries')
    const manager = restart(storage)
    await manager.get('a', 'user: one')
    await manager.get('b', 'user: two')
    expect(entries).toHaveBeenCalledOnce()
    storage.destroy()
  })

  it('works with storages that do not implement entries()', async () => {
    const map = new Map()
    const storage: IStorage = {
      get: async k => map.get(k) ?? null,
      set: async (k, e) => { map.set(k, e) },
      delete: async k => { map.delete(k) },
      clear: async () => map.clear(),
    }
    const manager = restart(storage)
    await manager.set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await')
    expect((await manager.get('key2', 'user: what is async/await?'))?.value).toBe('cached')
  })

  it('a failing restore falls through in passthrough mode and is retried later', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    await restart(storage).set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await')

    const original = storage.entries.bind(storage)
    const entries = vi.spyOn(storage, 'entries')
      .mockImplementationOnce(() => { throw new Error('scan failed') })
      .mockImplementation(original)
    const manager = restart(storage)

    expect(await manager.get('key2', 'user: what is async/await?')).toBeNull()
    expect((await manager.get('key2', 'user: what is async/await?'))?.value).toBe('cached')
    expect(entries).toHaveBeenCalledTimes(2)
    storage.destroy()
  })
})

describe('CacheManager — embedder failure on set', () => {
  const brokenEmbedder: IEmbedder = { dimensions: 3, embed: vi.fn().mockRejectedValue(new Error('embed failed')) }

  it('still caches the response for exact matches (passthrough)', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const manager = new CacheManager({ storage, semantic: { embedder: brokenEmbedder, threshold: 0.9 } })
    await expect(manager.set('k', { type: 'full', value: 'v' }, 'text')).resolves.toBeUndefined()
    expect((await storage.get('k'))?.value).toBe('v')
    storage.destroy()
  })

  it('still caches the response, then rethrows when onStorageError is throw', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const manager = new CacheManager({ storage, onStorageError: 'throw', semantic: { embedder: brokenEmbedder, threshold: 0.9 } })
    await expect(manager.set('k', { type: 'full', value: 'v' }, 'text')).rejects.toThrow('embed failed')
    expect((await storage.get('k'))?.value).toBe('v')
    storage.destroy()
  })
})
