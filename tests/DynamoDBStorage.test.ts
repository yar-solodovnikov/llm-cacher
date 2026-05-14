import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DynamoDBStorage } from '../src/storage/DynamoDBStorage'
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

function makeDynamoClient() {
  const store = new Map<string, Record<string, { S?: string; N?: string }>>()

  return {
    send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name

      if (name === 'PutItemCommand') {
        const input = command.input as { TableName: string; Item: Record<string, { S?: string; N?: string }> }
        const key = input.Item['pk']?.S ?? ''
        store.set(key, input.Item)
        return {}
      }

      if (name === 'GetItemCommand') {
        const input = command.input as { Key: { pk: { S: string } } }
        const key = input.Key['pk']?.S ?? ''
        const item = store.get(key)
        return { Item: item }
      }

      if (name === 'DeleteItemCommand') {
        const input = command.input as { Key: { pk: { S: string } } }
        const key = input.Key['pk']?.S ?? ''
        store.delete(key)
        return {}
      }

      if (name === 'ScanCommand') {
        return { Items: [...store.values()] }
      }

      if (name === 'BatchWriteItemCommand') {
        const input = command.input as { RequestItems: Record<string, { DeleteRequest: { Key: { pk: { S: string } } } }[]> }
        const requests = Object.values(input.RequestItems).flat()
        requests.forEach(r => store.delete(r.DeleteRequest.Key['pk']?.S ?? ''))
        return {}
      }

      return {}
    }),
  }
}

describe('DynamoDBStorage', () => {
  let client: ReturnType<typeof makeDynamoClient>
  let storage: DynamoDBStorage

  beforeEach(() => {
    client = makeDynamoClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage = new DynamoDBStorage({ tableName: 'llm-cache', client: client as any })
  })

  it('stores and retrieves an entry', async () => {
    const entry = makeEntry('k1')
    await storage.set('k1', entry)
    expect(await storage.get('k1')).toEqual(entry)
  })

  it('returns null for missing key', async () => {
    expect(await storage.get('missing')).toBeNull()
  })

  it('stores TTL as Unix seconds in the ttl attribute', async () => {
    const expiresAt = Date.now() + 60_000
    await storage.set('k1', makeEntry('k1', { expiresAt }))
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining({
            ttl: { N: String(Math.floor(expiresAt / 1000)) },
          }),
        }),
      }),
    )
  })

  it('returns null for client-side expired entry', async () => {
    await storage.set('k1', makeEntry('k1', { expiresAt: Date.now() - 1 }))
    expect(await storage.get('k1')).toBeNull()
  })

  it('deletes an entry', async () => {
    await storage.set('k1', makeEntry('k1'))
    await storage.delete('k1')
    expect(await storage.get('k1')).toBeNull()
  })

  it('clears all entries', async () => {
    await storage.set('a', makeEntry('a'))
    await storage.set('b', makeEntry('b'))
    await storage.clear()
    expect(await storage.get('a')).toBeNull()
    expect(await storage.get('b')).toBeNull()
  })
})
