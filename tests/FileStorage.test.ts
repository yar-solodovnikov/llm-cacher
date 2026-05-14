import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync } from 'fs'
import { FileStorage } from '../src/storage/FileStorage'
import type { CacheEntry } from '../src/storage/IStorage'

const TEST_PATH = './test-cache.json'

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

describe('FileStorage', () => {
  let storage: FileStorage

  beforeEach(() => {
    storage = new FileStorage({ path: TEST_PATH })
  })

  afterEach(() => {
    if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH)
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
    // expired entry should be cleaned from file
    expect(await storage.get('k1')).toBeNull()
  })

  it('overwrites existing entry on set', async () => {
    await storage.set('k1', makeEntry('k1', { value: 'old' }))
    await storage.set('k1', makeEntry('k1', { value: 'new' }))
    const entry = await storage.get('k1')
    expect(entry?.value).toBe('new')
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

  it('persists data between instances', async () => {
    await storage.set('k1', makeEntry('k1', { value: 'persisted' }))
    const storage2 = new FileStorage({ path: TEST_PATH })
    expect((await storage2.get('k1'))?.value).toBe('persisted')
  })
})
