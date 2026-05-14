import type { Database } from 'better-sqlite3'
import type { CacheEntry, IStorage } from './IStorage'

export interface SQLiteStorageOptions {
  path?: string
  db?: Database
  tableName?: string
}

export class SQLiteStorage implements IStorage {
  private db: Database
  private readonly table: string

  constructor(opts: SQLiteStorageOptions = {}) {
    if (opts.db) {
      this.db = opts.db
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3').default
      this.db = new BetterSqlite3(opts.path ?? 'llm-cache.db')
    }
    this.table = opts.tableName ?? 'llm_cache'
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        expires_at INTEGER
      )
    `)
  }

  async get(key: string): Promise<CacheEntry | null> {
    const row = this.db
      .prepare(`SELECT value, expires_at FROM ${this.table} WHERE key = ?`)
      .get(key) as { value: string; expires_at: number | null } | undefined

    if (!row) return null

    if (row.expires_at !== null && Date.now() > row.expires_at) {
      this.db.prepare(`DELETE FROM ${this.table} WHERE key = ?`).run(key)
      return null
    }

    return JSON.parse(row.value) as CacheEntry
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ${this.table} (key, value, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      )
      .run(key, JSON.stringify(entry), entry.expiresAt)
  }

  async delete(key: string): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.table} WHERE key = ?`).run(key)
  }

  async clear(): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.table}`).run()
  }

  close(): void {
    this.db.close()
  }
}
