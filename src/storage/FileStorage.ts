import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { CacheEntry, IStorage } from './IStorage'
import { ENTRY_TYPE_FULL, ENTRY_TYPE_STREAM } from './IStorage'
import { FILE_ENCODING } from '../constants'

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
      return JSON.parse(readFileSync(this.path, FILE_ENCODING)) as FileStore
    } catch {
      return {}
    }
  }

  private write(store: FileStore): void {
    writeFileSync(this.path, JSON.stringify(store), FILE_ENCODING)
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

    if (entry.type !== ENTRY_TYPE_FULL && entry.type !== ENTRY_TYPE_STREAM) return null

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
