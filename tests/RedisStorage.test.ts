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
      'llm-cache:k1',
      expect.any(String),
      'PX',
      expect.any(Number),
    )
  })

  it('stores without TTL when expiresAt is null', async () => {
    const entry = makeEntry('k1', { expiresAt: null })
    await storage.set('k1', entry)
    expect(client.set).toHaveBeenCalledWith('llm-cache:k1', expect.any(String))
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
})
