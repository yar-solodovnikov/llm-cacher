import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../src/storage/SQLiteStorage'
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

describe('SQLiteStorage', () => {
  let storage: SQLiteStorage

  beforeEach(() => {
    // use in-memory SQLite for tests
    const db = new Database(':memory:')
    storage = new SQLiteStorage({ db })
  })

  afterEach(() => {
    storage.close()
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
    await storage.set('k1', makeEntry('k1', { expiresAt: Date.now() - 1 }))
    expect(await storage.get('k1')).toBeNull()
  })

  it('overwrites existing entry on set', async () => {
    await storage.set('k1', makeEntry('k1', { value: 'old' }))
    await storage.set('k1', makeEntry('k1', { value: 'new' }))
    expect((await storage.get('k1'))?.value).toBe('new')
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

  it('stores stream entries with chunks', async () => {
    const entry = makeEntry('k1', {
      type: 'stream',
      chunks: [{ delta: 'hello' }, { delta: ' world' }],
    })
    await storage.set('k1', entry)
    const result = await storage.get('k1')
    expect(result?.chunks).toEqual([{ delta: 'hello' }, { delta: ' world' }])
  })
})
