import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import type { CacheEntry } from '../src/storage/IStorage'

function makeEntry(key: string, overrides: Partial<CacheEntry> = {}): CacheEntry {
  return {
    key,
    type: 'full',
    value: { result: key },
    createdAt: Date.now(),
    expiresAt: null,
    ...overrides,
  }
}

describe('MemoryStorage', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
  })

  afterEach(() => {
    storage.destroy()
  })

  it('stores and retrieves an entry', async () => {
    const entry = makeEntry('k1')
    await storage.set('k1', entry)
    expect(await storage.get('k1')).toEqual(entry)
  })

  it('returns null for missing key', async () => {
    expect(await storage.get('missing')).toBeNull()
  })

  it('returns null and removes entry after TTL expires', async () => {
    const entry = makeEntry('k1', { expiresAt: Date.now() - 1 })
    await storage.set('k1', entry)
    expect(await storage.get('k1')).toBeNull()
    expect(storage.size).toBe(0)
  })

  it('evicts the oldest entry when maxSize is reached', async () => {
    storage = new MemoryStorage({ maxSize: 2 })
    await storage.set('a', makeEntry('a'))
    await storage.set('b', makeEntry('b'))
    await storage.set('c', makeEntry('c')) // should evict 'a'
    expect(await storage.get('a')).toBeNull()
    expect(await storage.get('b')).not.toBeNull()
    expect(await storage.get('c')).not.toBeNull()
  })

  it('LRU: recently accessed entry is not evicted first', async () => {
    storage = new MemoryStorage({ maxSize: 2 })
    await storage.set('a', makeEntry('a'))
    await storage.set('b', makeEntry('b'))
    await storage.get('a') // 'a' becomes most-recently-used
    await storage.set('c', makeEntry('c')) // should evict 'b'
    expect(await storage.get('b')).toBeNull()
    expect(await storage.get('a')).not.toBeNull()
  })

  it('clears all entries', async () => {
    await storage.set('a', makeEntry('a'))
    await storage.set('b', makeEntry('b'))
    await storage.clear()
    expect(storage.size).toBe(0)
  })

  it('deletes a specific entry', async () => {
    await storage.set('a', makeEntry('a'))
    await storage.delete('a')
    expect(await storage.get('a')).toBeNull()
  })

  it('sweep removes expired entries', async () => {
    vi.useFakeTimers()
    storage = new MemoryStorage({ sweepIntervalMs: 100 })
    await storage.set('expired', makeEntry('expired', { expiresAt: Date.now() - 1 }))
    await storage.set('live', makeEntry('live', { expiresAt: Date.now() + 100_000 }))
    vi.advanceTimersByTime(200)
    expect(storage.size).toBe(1)
    expect(await storage.get('live')).not.toBeNull()
    storage.destroy()
    vi.useRealTimers()
  })
})
