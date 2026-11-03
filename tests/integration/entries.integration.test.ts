import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Redis from 'ioredis'
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb'
import { RedisStorage } from '../../src/storage/RedisStorage'
import { DynamoDBStorage } from '../../src/storage/DynamoDBStorage'
import { CacheManager } from '../../src/core/CacheManager'
import type { CacheEntry, IStorage } from '../../src/storage/IStorage'
import type { IEmbedder } from '../../src/embeddings/IEmbedder'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:4566'
const TABLE_NAME = 'llm-cacher-entries-test'
const MANY = 250 // > REDIS_SCAN_COUNT, so SCAN needs several round trips

function makeEntry(key: string, overrides: Partial<CacheEntry> = {}): CacheEntry {
  return { key, type: 'full', value: { result: key }, createdAt: Date.now(), expiresAt: null, ...overrides }
}

async function collectKeys(storage: IStorage): Promise<string[]> {
  const keys: string[] = []
  for await (const entry of storage.entries!()) keys.push(entry.key)
  return keys.sort()
}

const embedder: IEmbedder = {
  dimensions: 3,
  embed: vi.fn(async (text: string) => (text.includes('async') ? [1, 0.001 * text.length, 0] : [0, 1, 0])),
}

// Two managers over one storage = a restarted process
async function expectIndexSurvivesRestart(storage: IStorage) {
  const opts = { storage, semantic: { embedder, threshold: 0.9 } }
  await new CacheManager(opts).set('key1', { type: 'full', value: 'cached' }, 'user: explain async/await', 'scope')
  const restarted = new CacheManager(opts)
  expect((await restarted.get('key2', 'user: what is async/await?', 'scope'))?.value).toBe('cached')
  expect(await restarted.get('key2', 'user: what is async/await?', 'other-scope')).toBeNull()
}

describe('RedisStorage.entries (integration)', () => {
  let redis: Redis
  let storage: RedisStorage
  let other: RedisStorage

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 3_000 })
    await redis.connect()
    storage = new RedisStorage({ client: redis, keyPrefix: 'llm-cacher-entries-test:' })
    other = new RedisStorage({ client: redis, keyPrefix: 'llm-cacher-entries-other:' })
    await storage.clear()
    await other.clear()
  })

  afterAll(async () => {
    await storage.clear()
    await other.clear()
    await redis.quit()
  })

  it('yields every entry across SCAN pages, only under its own prefix', async () => {
    const expected = Array.from({ length: MANY }, (_, i) => `k${String(i).padStart(3, '0')}`)
    for (const key of expected) await storage.set(key, makeEntry(key, { embedding: [1, 0, 0], scope: 's' }))
    await other.set('foreign', makeEntry('foreign'))

    expect(await collectKeys(storage)).toEqual(expected)
    await storage.clear()
  })

  it('round-trips embedding and scope', async () => {
    await storage.set('a', makeEntry('a', { embedding: [0.5, 0.25, 0], scope: 'gpt-4o' }))
    const entries: CacheEntry[] = []
    for await (const entry of storage.entries()) entries.push(entry)
    expect(entries[0]).toMatchObject({ key: 'a', embedding: [0.5, 0.25, 0], scope: 'gpt-4o' })
    await storage.clear()
  })

  it('restores the semantic index after a restart', async () => {
    await expectIndexSurvivesRestart(storage)
    await storage.clear()
  })
})

describe('DynamoDBStorage.entries (integration)', () => {
  let client: DynamoDBClient
  let storage: DynamoDBStorage

  beforeAll(async () => {
    client = new DynamoDBClient({ region: 'us-east-1', endpoint: ENDPOINT, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
    await client.send(new CreateTableCommand({
      TableName: TABLE_NAME,
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
    }))
    storage = new DynamoDBStorage({ tableName: TABLE_NAME, client })
  })

  afterAll(async () => {
    await client.send(new DeleteTableCommand({ TableName: TABLE_NAME }))
    client.destroy()
  })

  it('yields every live entry and skips expired ones', async () => {
    const expected = Array.from({ length: 30 }, (_, i) => `k${String(i).padStart(2, '0')}`)
    for (const key of expected) await storage.set(key, makeEntry(key))
    await storage.set('expired', makeEntry('expired', { expiresAt: Date.now() - 1 }))

    expect(await collectKeys(storage)).toEqual(expected)
    await storage.clear()
  })

  it('reads entries with a custom value attribute', async () => {
    const custom = new DynamoDBStorage({ tableName: TABLE_NAME, client, valueAttribute: 'payload' })
    await custom.set('c1', makeEntry('c1', { embedding: [1, 0, 0] }))
    expect(await collectKeys(custom)).toEqual(['c1'])
    await custom.clear()
  })

  it('restores the semantic index after a restart', async () => {
    await expectIndexSurvivesRestart(storage)
    await storage.clear()
  })
})
