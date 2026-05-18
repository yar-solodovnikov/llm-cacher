import { describe, it, expect, vi } from 'vitest'
import { CacheManager } from '../src/core/CacheManager'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import type { IStorage } from '../src/storage/IStorage'
import type { IEmbedder } from '../src/embeddings/IEmbedder'

function makeBrokenStorage(): IStorage {
  return {
    get: vi.fn().mockRejectedValue(new Error('storage down')),
    set: vi.fn().mockRejectedValue(new Error('storage down')),
    delete: vi.fn().mockRejectedValue(new Error('storage down')),
    clear: vi.fn().mockRejectedValue(new Error('storage down')),
  }
}

function makeBrokenEmbedder(): IEmbedder {
  return {
    dimensions: 3,
    embed: vi.fn().mockRejectedValue(new Error('embed failed')),
  }
}

describe('CacheManager', () => {
  it('returns null on cache miss', async () => {
    const manager = new CacheManager({ storage: new MemoryStorage() })
    expect(await manager.get('nonexistent')).toBeNull()
  })

  it('stores and retrieves a full entry', async () => {
    const manager = new CacheManager({ storage: new MemoryStorage() })
    await manager.set('k1', { type: 'full', value: { answer: 42 } })
    const entry = await manager.get('k1')
    expect(entry?.value).toEqual({ answer: 42 })
  })

  it('respects TTL — entry expires after the given time', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const manager = new CacheManager({ storage, ttl: '1s' })
    await manager.set('k1', { type: 'full', value: 'hello' })
    vi.advanceTimersByTime(1001)
    expect(await manager.get('k1')).toBeNull()
    storage.destroy()
    vi.useRealTimers()
  })

  it('stores expiresAt: null when no TTL is configured', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const manager = new CacheManager({ storage })
    await manager.set('k1', { type: 'full', value: 'test' })
    const entry = await storage.get('k1')
    expect(entry?.expiresAt).toBeNull()
    storage.destroy()
  })

  it('stores correct expiresAt when TTL is configured', async () => {
    vi.useFakeTimers()
    const now = 1_000_000
    vi.setSystemTime(now)
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const manager = new CacheManager({ storage, ttl: '5s' })
    await manager.set('k1', { type: 'full', value: 'test' })
    const entry = await storage.get('k1')
    expect(entry?.expiresAt).toBe(now + 5_000)
    storage.destroy()
    vi.useRealTimers()
  })

  it('onStorageError: passthrough — get returns null instead of throwing', async () => {
    const manager = new CacheManager({ storage: makeBrokenStorage(), onStorageError: 'passthrough' })
    await expect(manager.get('k')).resolves.toBeNull()
  })

  it('onStorageError: passthrough — set silently swallows error', async () => {
    const manager = new CacheManager({ storage: makeBrokenStorage(), onStorageError: 'passthrough' })
    await expect(manager.set('k', { type: 'full', value: null })).resolves.toBeUndefined()
  })

  it('onStorageError: throw — get rethrows', async () => {
    const manager = new CacheManager({ storage: makeBrokenStorage(), onStorageError: 'throw' })
    await expect(manager.get('k')).rejects.toThrow('storage down')
  })

  it('onStorageError: throw — set rethrows', async () => {
    const manager = new CacheManager({ storage: makeBrokenStorage(), onStorageError: 'throw' })
    await expect(manager.set('k', { type: 'full', value: null })).rejects.toThrow('storage down')
  })

  it('throws on TTL = 0 (would silently produce instant-expiry cache)', () => {
    expect(() => new CacheManager({ storage: new MemoryStorage(), ttl: 0 })).toThrow('positive')
  })

  it('throws on negative TTL', () => {
    expect(() => new CacheManager({ storage: new MemoryStorage(), ttl: -1000 })).toThrow('positive')
  })

  it('throws on NaN TTL (would silently disable expiry)', () => {
    expect(() => new CacheManager({ storage: new MemoryStorage(), ttl: NaN })).toThrow('positive')
  })

  it('throws on TTL string "0ms"', () => {
    expect(() => new CacheManager({ storage: new MemoryStorage(), ttl: '0ms' })).toThrow('positive')
  })

  it('parses string TTL formats correctly', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const manager = new CacheManager({ storage, ttl: '500ms' })
    await manager.set('k', { type: 'full', value: 1 })
    vi.advanceTimersByTime(499)
    expect(await manager.get('k')).not.toBeNull()
    vi.advanceTimersByTime(2)
    expect(await manager.get('k')).toBeNull()
    storage.destroy()
    vi.useRealTimers()
  })

  it('embedder throwing during get is handled by onStorageError: passthrough', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const manager = new CacheManager({
      storage,
      semantic: { embedder: makeBrokenEmbedder(), threshold: 0.9 },
      onStorageError: 'passthrough',
    })
    // exact miss, then embedder.embed() throws → passthrough → null
    const result = await manager.get('no-such-key', 'some text')
    expect(result).toBeNull()
    storage.destroy()
  })

  it('embedder throwing during get rethrows when onStorageError is throw', async () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    const manager = new CacheManager({
      storage,
      semantic: { embedder: makeBrokenEmbedder(), threshold: 0.9 },
      onStorageError: 'throw',
    })
    await expect(manager.get('no-such-key', 'some text')).rejects.toThrow('embed failed')
    storage.destroy()
  })
})
