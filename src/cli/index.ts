#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs'

const DEFAULT_STORAGE_TYPE = 'sqlite'
const DEFAULT_SQLITE_PATH = './llm-cache.db'
const DEFAULT_FILE_PATH = './llm-cache.json'
const DEFAULT_LIST_LIMIT = 20

const [, , command, ...rawArgs] = process.argv

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1]
      i++
    }
  }
  return result
}

function printHelp(): void {
  console.log(`
llm-cache CLI

Commands:
  stats   Show cache statistics
  list    List cached entries
  clear   Delete all cached entries

Options:
  --storage  Storage type: file | sqlite (default: sqlite)
  --path     Path to cache file (default: ./llm-cache.db or ./llm-cache.json)
  --limit    Max entries to list (default: 20)

Examples:
  llm-cache stats --storage sqlite --path ./cache.db
  llm-cache list  --storage file   --path ./cache.json --limit 10
  llm-cache clear --storage sqlite --path ./cache.db
  `)
}

async function getStorage(type: string, path: string) {
  if (type === 'file') {
    const { FileStorage } = await import('../storage/FileStorage.js')
    return new FileStorage({ path })
  }
  const { SQLiteStorage } = await import('../storage/SQLiteStorage.js')
  return new SQLiteStorage({ path })
}

// SQLite-specific stats using raw query
function getSQLiteStats(path: string): { total: number; expired: number } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const db = new Database(path, { readonly: true })
  const total = (db.prepare('SELECT COUNT(*) as n FROM llm_cache').get() as { n: number }).n
  const expired = (db.prepare(
    'SELECT COUNT(*) as n FROM llm_cache WHERE expires_at IS NOT NULL AND expires_at < ?',
  ).get(Date.now()) as { n: number }).n
  db.close()
  return { total, expired }
}

// File-specific stats
function getFileStats(path: string): { total: number; expired: number } {
  if (!existsSync(path)) return { total: 0, expired: 0 }
  try {
    const store = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { expiresAt: number | null }>
    const now = Date.now()
    const total = Object.keys(store).length
    const expired = Object.values(store).filter(e => e.expiresAt !== null && now > e.expiresAt).length
    return { total, expired }
  } catch {
    return { total: 0, expired: 0 }
  }
}

async function main() {
  const args = parseArgs(rawArgs)
  const storageType = args['storage'] ?? DEFAULT_STORAGE_TYPE
  const defaultPath = storageType === 'file' ? DEFAULT_FILE_PATH : DEFAULT_SQLITE_PATH
  const storagePath = args['path'] ?? defaultPath

  if (!command || command === 'help' || command === '--help') {
    printHelp()
    return
  }

  if (command === 'stats') {
    let stats: { total: number; expired: number }
    if (storageType === 'sqlite') {
      if (!existsSync(storagePath)) {
        console.log('Cache file not found:', storagePath)
        return
      }
      stats = getSQLiteStats(storagePath)
    } else {
      stats = getFileStats(storagePath)
    }
    console.log('\nCache Statistics')
    console.log('================')
    console.log(`Storage:  ${storageType} (${storagePath})`)
    console.log(`Entries:  ${stats.total}`)
    console.log(`Expired:  ${stats.expired} (not yet cleaned up)`)
    console.log(`Active:   ${stats.total - stats.expired}\n`)
    return
  }

  if (command === 'list') {
    const limit = parseInt(args['limit'] ?? String(DEFAULT_LIST_LIMIT), 10)
    const storage = await getStorage(storageType, storagePath)
    // list is not on IStorage interface — read directly
    let keys: string[] = []
    if (storageType === 'sqlite') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3') as typeof import('better-sqlite3')
      const db = new Database(storagePath, { readonly: true })
      keys = (db.prepare(`SELECT key FROM llm_cache LIMIT ?`).all(limit) as { key: string }[]).map(r => r.key)
      db.close()
    } else {
      if (existsSync(storagePath)) {
        try {
          const store = JSON.parse(readFileSync(storagePath, 'utf8')) as Record<string, unknown>
          keys = Object.keys(store).slice(0, limit)
        } catch { /* empty or invalid file */ }
      }
    }

    if (keys.length === 0) {
      console.log('Cache is empty.')
      return
    }
    console.log(`\nCached entries (${keys.length}):`)
    keys.forEach((k, i) => console.log(`  ${i + 1}. ${k}`))
    console.log()
    void storage
    return
  }

  if (command === 'clear') {
    const storage = await getStorage(storageType, storagePath)
    await storage.clear()
    console.log(`Cache cleared (${storageType}: ${storagePath})`)
    return
  }

  console.error(`Unknown command: "${command}". Run llm-cache --help for usage.`)
  process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
