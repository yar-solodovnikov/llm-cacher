#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs'
import { FILE_ENCODING, DEFAULT_FILE_PATH, DEFAULT_SQLITE_PATH, DEFAULT_TABLE_NAME } from '../constants'

const STORAGE_TYPE_SQLITE = 'sqlite'
const STORAGE_TYPE_FILE = 'file'
const DEFAULT_STORAGE_TYPE = STORAGE_TYPE_SQLITE
const DEFAULT_LIST_LIMIT = 20

const CLI_ARG_PREFIX = '--'
const ARG_PREFIX_LENGTH = CLI_ARG_PREFIX.length
const ARG_STORAGE = 'storage'
const ARG_PATH = 'path'
const ARG_LIMIT = 'limit'

const COMMAND_STATS = 'stats'
const COMMAND_LIST = 'list'
const COMMAND_CLEAR = 'clear'
const COMMAND_HELP = 'help'
const COMMAND_HELP_FLAG = '--help'

const MSG_CACHE_FILE_NOT_FOUND = 'Cache file not found:'
const MSG_CACHE_EMPTY = 'Cache is empty.'
const MSG_STATS_HEADER = '\nCache Statistics'
const MSG_STATS_DIVIDER = '================'

const [, , command, ...rawArgs] = process.argv

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(CLI_ARG_PREFIX) && args[i + 1] && !args[i + 1].startsWith(CLI_ARG_PREFIX)) {
      result[args[i].slice(ARG_PREFIX_LENGTH)] = args[i + 1]
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
  if (type === STORAGE_TYPE_FILE) {
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
  const total = (db.prepare(`SELECT COUNT(*) as n FROM ${DEFAULT_TABLE_NAME}`).get() as { n: number }).n
  const expired = (db.prepare(
    `SELECT COUNT(*) as n FROM ${DEFAULT_TABLE_NAME} WHERE expires_at IS NOT NULL AND expires_at < ?`,
  ).get(Date.now()) as { n: number }).n
  db.close()
  return { total, expired }
}

// File-specific stats
function getFileStats(path: string): { total: number; expired: number } {
  if (!existsSync(path)) return { total: 0, expired: 0 }
  try {
    const store = JSON.parse(readFileSync(path, FILE_ENCODING)) as Record<string, { expiresAt: number | null }>
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
  const storageType = args[ARG_STORAGE] ?? DEFAULT_STORAGE_TYPE
  const defaultPath = storageType === STORAGE_TYPE_FILE ? DEFAULT_FILE_PATH : DEFAULT_SQLITE_PATH
  const storagePath = args[ARG_PATH] ?? defaultPath

  if (!command || command === COMMAND_HELP || command === COMMAND_HELP_FLAG) {
    printHelp()
    return
  }

  if (command === COMMAND_STATS) {
    let stats: { total: number; expired: number }
    if (storageType === STORAGE_TYPE_SQLITE) {
      if (!existsSync(storagePath)) {
        console.log(MSG_CACHE_FILE_NOT_FOUND, storagePath)
        return
      }
      stats = getSQLiteStats(storagePath)
    } else {
      stats = getFileStats(storagePath)
    }
    console.log(MSG_STATS_HEADER)
    console.log(MSG_STATS_DIVIDER)
    console.log(`Storage:  ${storageType} (${storagePath})`)
    console.log(`Entries:  ${stats.total}`)
    console.log(`Expired:  ${stats.expired} (not yet cleaned up)`)
    console.log(`Active:   ${stats.total - stats.expired}\n`)
    return
  }

  if (command === COMMAND_LIST) {
    const rawLimit = parseInt(args[ARG_LIMIT] ?? String(DEFAULT_LIST_LIMIT), 10)
    const limit = Number.isNaN(rawLimit) || rawLimit <= 0 ? DEFAULT_LIST_LIMIT : rawLimit
    // list is not on IStorage interface — read directly
    let keys: string[] = []
    if (storageType === STORAGE_TYPE_SQLITE) {
      if (!existsSync(storagePath)) {
        console.log(MSG_CACHE_EMPTY)
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3') as typeof import('better-sqlite3')
      const db = new Database(storagePath, { readonly: true })
      keys = (db.prepare(`SELECT key FROM ${DEFAULT_TABLE_NAME} LIMIT ?`).all(limit) as { key: string }[]).map(r => r.key)
      db.close()
    } else {
      if (existsSync(storagePath)) {
        try {
          const store = JSON.parse(readFileSync(storagePath, FILE_ENCODING)) as Record<string, unknown>
          keys = Object.keys(store).slice(0, limit)
        } catch { /* empty or invalid file */ }
      }
    }

    if (keys.length === 0) {
      console.log(MSG_CACHE_EMPTY)
      return
    }
    console.log(`\nCached entries (${keys.length}):`)
    keys.forEach((k, i) => console.log(`  ${i + 1}. ${k}`))
    console.log()
    return
  }

  if (command === COMMAND_CLEAR) {
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
