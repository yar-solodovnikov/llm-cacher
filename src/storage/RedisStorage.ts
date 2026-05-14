import type { Redis, RedisOptions } from 'ioredis'
import type { CacheEntry, IStorage } from './IStorage'

export interface RedisStorageOptions {
  url?: string
  client?: Redis
  options?: RedisOptions
  keyPrefix?: string
}

const DEFAULT_KEY_PREFIX = 'llm-cache:'
const REDIS_SCAN_COUNT = 100

export class RedisStorage implements IStorage {
  private client: Redis
  private readonly keyPrefix: string

  constructor(opts: RedisStorageOptions = {}) {
    if (opts.client) {
      this.client = opts.client
    } else {
      // dynamic import to keep ioredis optional
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const IORedis = require('ioredis') as typeof import('ioredis').default
      this.client = opts.url ? new IORedis(opts.url, opts.options ?? {}) : new IORedis(opts.options ?? {})
    }
    this.keyPrefix = opts.keyPrefix ?? DEFAULT_KEY_PREFIX
  }

  private prefixed(key: string): string {
    return `${this.keyPrefix}${key}`
  }

  async get(key: string): Promise<CacheEntry | null> {
    const raw = await this.client.get(this.prefixed(key))
    if (!raw) return null
    return JSON.parse(raw) as CacheEntry
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const serialized = JSON.stringify(entry)
    const prefixedKey = this.prefixed(key)

    if (entry.expiresAt !== null) {
      const ttlMs = entry.expiresAt - Date.now()
      if (ttlMs <= 0) return
      await this.client.set(prefixedKey, serialized, 'PX', ttlMs)
    } else {
      await this.client.set(prefixedKey, serialized)
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.prefixed(key))
  }

  async clear(): Promise<void> {
    const pattern = `${this.keyPrefix}*`
    let cursor = '0'
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', REDIS_SCAN_COUNT)
      cursor = next
      if (keys.length > 0) await this.client.del(...keys)
    } while (cursor !== '0')
  }

  quit(): Promise<'OK'> {
    return this.client.quit()
  }
}
