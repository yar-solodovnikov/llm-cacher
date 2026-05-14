import type { CacheEntry, IStorage } from './IStorage'

export interface MemoryStorageOptions {
  maxSize?: number
  sweepIntervalMs?: number
}

export class MemoryStorage implements IStorage {
  private store = new Map<string, CacheEntry>()
  private readonly maxSize: number
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: MemoryStorageOptions = {}) {
    this.maxSize = options.maxSize ?? 1000
    const interval = options.sweepIntervalMs ?? 60_000
    this.sweepTimer = setInterval(() => this.sweep(), interval)
    // don't keep the process alive just for sweep
    this.sweepTimer.unref?.()
  }

  async get(key: string): Promise<CacheEntry | null> {
    const entry = this.store.get(key)
    if (!entry) return null

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }

    // LRU: re-insert at end (Map preserves insertion order)
    this.store.delete(key)
    this.store.set(key, entry)
    return entry
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    if (this.store.has(key)) {
      this.store.delete(key)
    } else if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    this.store.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key)
      }
    }
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }
}
