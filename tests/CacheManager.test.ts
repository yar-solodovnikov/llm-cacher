import { describe, it, expect, vi } from 'vitest'
import { CacheManager } from '../src/core/CacheManager'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import type { IStorage } from '../src/storage/IStorage'

function makeBrokenStorage(): IStorage {
  return {
    get: vi.fn().mockRejectedValue(new Error('storage down')),
    set: vi.fn().mockRejectedValue(new Error('storage down')),
    delete: vi.fn().mockRejectedValue(new Error('storage down')),
    clear: vi.fn().mockRejectedValue(new Error('storage down')),
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
})
