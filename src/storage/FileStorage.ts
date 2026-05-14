import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { CacheEntry, IStorage } from './IStorage'

export interface FileStorageOptions {
  path: string
}

type FileStore = Record<string, CacheEntry>

export class FileStorage implements IStorage {
  private readonly path: string

  constructor(options: FileStorageOptions) {
    this.path = options.path
  }

  private read(): FileStore {
    if (!existsSync(this.path)) return {}
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as FileStore
    } catch {
      return {}
    }
  }

  private write(store: FileStore): void {
    writeFileSync(this.path, JSON.stringify(store), 'utf8')
  }

  async get(key: string): Promise<CacheEntry | null> {
    const store = this.read()
    const entry = store[key]
    if (!entry) return null

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      delete store[key]
      this.write(store)
      return null
    }

    return entry
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const store = this.read()
    store[key] = entry
    this.write(store)
  }

  async delete(key: string): Promise<void> {
    const store = this.read()
    delete store[key]
    this.write(store)
  }

  async clear(): Promise<void> {
    this.write({})
  }
}
