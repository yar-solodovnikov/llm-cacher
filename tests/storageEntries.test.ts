import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import { FileStorage } from '../src/storage/FileStorage'
import { SQLiteStorage } from '../src/storage/SQLiteStorage'
import { RedisStorage } from '../src/storage/RedisStorage'
import { DynamoDBStorage } from '../src/storage/DynamoDBStorage'
import type { CacheEntry, IStorage } from '../src/storage/IStorage'

function makeEntry(key: string, overrides: Partial<CacheEntry> = {}): CacheEntry {
  return { key, type: 'full', value: { result: key }, createdAt: Date.now(), expiresAt: null, ...overrides }
}

function makeRedisClient() {
  const store = new Map<string, string>()
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK' }),
    del: vi.fn(async (...keys: string[]) => { keys.forEach(k => store.delete(k)); return keys.length }),
    mget: vi.fn(async (...keys: string[]) => keys.map(k => store.get(k) ?? null)),
    // two pages, to exercise cursor handling
    scan: vi.fn(async (cursor: string, _match: string, pattern: string) => {
      const keys = [...store.keys()].filter(k => k.startsWith(pattern.replace('*', '')))
      const half = Math.ceil(keys.length / 2)
      return cursor === '0' ? ['1', keys.slice(0, half)] : ['0', keys.slice(half)]
    }),
  }
}

function makeDynamoClient() {
  const store = new Map<string, Record<string, { S?: string }>>()
  return {
    store,
    send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name
      if (name === 'PutItemCommand') {
        const item = (command.input as { Item: Record<string, { S?: string }> }).Item
        store.set(item.pk.S!, item)
        return {}
      }
      if (name === 'ScanCommand') {
        // two pages, to exercise LastEvaluatedKey handling
        const items = [...store.values()]
        const half = Math.ceil(items.length / 2)
        return command.input.ExclusiveStartKey
          ? { Items: items.slice(half) }
          : { Items: items.slice(0, half), LastEvaluatedKey: items.length > half ? { pk: { S: 'page' } } : undefined }
      }
      return {}
    }),
  }
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Backend = { storage: IStorage; corrupt: (key: string) => void }

const backends: [string, () => Backend][] = [
  ['MemoryStorage', () => {
    const storage = new MemoryStorage({ sweepIntervalMs: 999_999 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { storage, corrupt: (key: string) => { (storage as any).store.get(key).type = 'bogus' } }
  }],
  ['FileStorage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-cacher-'))
    tempDirs.push(dir)
    const path = join(dir, 'cache.json')
    const corrupt = (key: string) => {
      const store = JSON.parse(readFileSync(path, 'utf8'))
      store[key] = { ...store[key], type: 'bogus' }
      writeFileSync(path, JSON.stringify(store))
    }
    return { storage: new FileStorage({ path }), corrupt }
  }],
  ['SQLiteStorage', () => {
    const db = new Database(':memory:')
    return {
      storage: new SQLiteStorage({ db }),
      corrupt: (key: string) => { db.prepare('UPDATE "llm_cache" SET value = ? WHERE key = ?').run('{not json', key) },
    }
  }],
  ['RedisStorage', () => {
    const client = makeRedisClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { storage: new RedisStorage({ client: client as any }), corrupt: (key: string) => { client.store.set(`llm-cacher:${key}`, '{not json') } }
  }],
  ['DynamoDBStorage', () => {
    const client = makeDynamoClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { storage: new DynamoDBStorage({ tableName: 't', client: client as any }), corrupt: (key: string) => { client.store.get(key)!.value = { S: '{not json' } } }
  }],
]

async function collect(storage: IStorage): Promise<CacheEntry[]> {
  const out: CacheEntry[] = []
  for await (const entry of storage.entries!()) out.push(entry)
  return out
}

describe.each(backends)('%s.entries()', (_name, make) => {
  it('yields every live entry with its embedding and scope', async () => {
    const { storage } = make()
    await storage.set('a', makeEntry('a', { embedding: [1, 0, 0], scope: 's1' }))
    await storage.set('b', makeEntry('b'))
    await storage.set('c', makeEntry('c', { type: 'stream', value: null, chunks: [1, 2] }))

    const entries = await collect(storage)
    expect(entries.map(e => e.key).sort()).toEqual(['a', 'b', 'c'])
    const a = entries.find(e => e.key === 'a')!
    expect(a.embedding).toEqual([1, 0, 0])
    expect(a.scope).toBe('s1')
  })

  it('skips expired entries', async () => {
    const { storage } = make()
    await storage.set('live', makeEntry('live', { expiresAt: Date.now() + 60_000 }))
    // written directly with a past expiry; Redis would have dropped it, so only check others
    await storage.set('dead', makeEntry('dead', { expiresAt: Date.now() - 1 }))
    const keys = (await collect(storage)).map(e => e.key)
    expect(keys).toContain('live')
    expect(keys).not.toContain('dead')
  })

  it('skips corrupted entries instead of failing the scan', async () => {
    const { storage, corrupt } = make()
    await storage.set('good', makeEntry('good'))
    await storage.set('bad', makeEntry('bad'))
    corrupt('bad')
    expect((await collect(storage)).map(e => e.key)).toEqual(['good'])
  })

  it('yields nothing for an empty store', async () => {
    const { storage } = make()
    expect(await collect(storage)).toEqual([])
  })
})

describe('entries() stops fetching when the consumer stops', () => {
  it('DynamoDBStorage does not request further Scan pages', async () => {
    const client = makeDynamoClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = new DynamoDBStorage({ tableName: 't', client: client as any })
    for (const key of ['a', 'b', 'c', 'd']) await storage.set(key, makeEntry(key))
    client.send.mockClear()

    for await (const _ of storage.entries()) break

    const scans = client.send.mock.calls.filter(([command]) => command.constructor.name === 'ScanCommand')
    expect(scans).toHaveLength(1)
  })

  it('RedisStorage does not continue the SCAN', async () => {
    const client = makeRedisClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = new RedisStorage({ client: client as any })
    for (const key of ['a', 'b', 'c', 'd']) await storage.set(key, makeEntry(key))

    for await (const _ of storage.entries()) break

    expect(client.scan).toHaveBeenCalledOnce()
  })
})
