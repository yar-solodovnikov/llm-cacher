import type { Database } from 'better-sqlite3'
import type { CacheEntry, IStorage } from './IStorage'
import { ENTRY_TYPE_FULL, ENTRY_TYPE_STREAM } from './IStorage'
import { DEFAULT_SQLITE_PATH, DEFAULT_TABLE_NAME } from '../constants'

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
      const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3')
      this.db = new BetterSqlite3(opts.path ?? DEFAULT_SQLITE_PATH)
    }
    const tableName = opts.tableName ?? DEFAULT_TABLE_NAME
    if (!/^\w+$/.test(tableName)) throw new Error(`Invalid tableName: "${tableName}". Use only letters, digits, and underscores.`)
    this.table = `"${tableName}"` // quoted identifier — safe in SQL even if validation is bypassed
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

    const entry = JSON.parse(row.value) as CacheEntry
    if (entry.type !== ENTRY_TYPE_FULL && entry.type !== ENTRY_TYPE_STREAM) return null
    return entry
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
