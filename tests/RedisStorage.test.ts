import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RedisStorage } from '../src/storage/RedisStorage'
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

function makeRedisClient() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
      store.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (...keys: string[]) => {
      keys.flat().forEach(k => store.delete(k))
      return keys.length
    }),
    scan: vi.fn(async (_cursor: string, _match: string, pattern: string) => {
      const prefix = pattern.replace('*', '')
      return ['0', [...store.keys()].filter(k => k.startsWith(prefix))]
    }),
    quit: vi.fn(async () => 'OK'),
  }
}

describe('RedisStorage', () => {
  let client: ReturnType<typeof makeRedisClient>
  let storage: RedisStorage

  beforeEach(() => {
    client = makeRedisClient()
    storage = new RedisStorage({ client: client as unknown as import('ioredis').Redis })
  })

  it('stores and retrieves an entry', async () => {
    const entry = makeEntry('k1')
    await storage.set('k1', entry)
    expect(await storage.get('k1')).toEqual(entry)
  })

  it('returns null for missing key', async () => {
    expect(await storage.get('missing')).toBeNull()
  })

  it('sets TTL via PX when expiresAt is provided', async () => {
    const entry = makeEntry('k1', { expiresAt: Date.now() + 60_000 })
    await storage.set('k1', entry)
    expect(client.set).toHaveBeenCalledWith(
      'llm-cacher:k1',
      expect.any(String),
      'PX',
      expect.any(Number),
    )
  })

  it('stores without TTL when expiresAt is null', async () => {
    const entry = makeEntry('k1', { expiresAt: null })
    await storage.set('k1', entry)
    expect(client.set).toHaveBeenCalledWith('llm-cacher:k1', expect.any(String))
  })

  it('does not call Redis set when entry is already expired', async () => {
    await storage.set('k1', makeEntry('k1', { expiresAt: Date.now() - 1 }))
    expect(client.set).not.toHaveBeenCalled()
  })

  it('deletes an entry', async () => {
    await storage.set('k1', makeEntry('k1'))
    await storage.delete('k1')
    expect(await storage.get('k1')).toBeNull()
  })

  it('clears all entries with matching prefix', async () => {
    await storage.set('a', makeEntry('a'))
    await storage.set('b', makeEntry('b'))
    await storage.clear()
    expect(client.del).toHaveBeenCalled()
  })

  it('applies key prefix', async () => {
    const s = new RedisStorage({ client: client as unknown as import('ioredis').Redis, keyPrefix: 'my-app:' })
    await s.set('k1', makeEntry('k1'))
    expect(client.set).toHaveBeenCalledWith('my-app:k1', expect.any(String))
  })

  it('stores and retrieves a stream entry with chunks', async () => {
    const entry = makeEntry('k1', {
      type: 'stream',
      chunks: [{ delta: 'Hello' }, { delta: ' world' }],
    })
    await storage.set('k1', entry)
    const result = await storage.get('k1')
    expect(result?.type).toBe('stream')
    expect(result?.chunks).toEqual([{ delta: 'Hello' }, { delta: ' world' }])
  })

  it('returns null for an entry with an invalid type', async () => {
    const corrupt = JSON.stringify({ key: 'k1', type: 'invalid', value: 'x', createdAt: Date.now(), expiresAt: null })
    client.get.mockResolvedValueOnce(corrupt)
    expect(await storage.get('k1')).toBeNull()
  })
})
